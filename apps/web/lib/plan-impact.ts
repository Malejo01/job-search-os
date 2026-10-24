import {
  CANDIDATE_CAP,
  createLogger,
  loadActiveRules,
  loadProfilePrefilterPrefs,
  safeDbError,
  selectPoolCandidates,
} from "@job-search-os/adapters";
import { schema as s } from "@job-search-os/db";
import {
  SIMULATE_MIN_CANDIDATES,
  STUDY_HOURS_DEFAULT,
  buildStudyRoute,
  compileTaxonomy,
  countGapMentions,
  fitCacheValue,
  monthlyUsd,
  parseStudyHours,
  simulateSkillImpact,
  simulateSkills,
  type RoleKey,
  type RouteSkill,
  type RouteStep,
  type SimCandidate,
  type SimInput,
} from "@job-search-os/pipeline";
import { and, desc, eq, gte, inArray, ne } from "drizzle-orm";
import { unstable_cache } from "next/cache";
import { withUser } from "./db";
import { planImpactCacheTag } from "./insights-cache";

/**
 * «Si aprendés…» de /plan (ronda 121, E3b): cuántas ofertas del pool te empezarían a calzar si
 * llevás una skill del plan a nivel 2, y en qué orden conviene estudiarlas. Corre con el rol de la
 * app y `app.user_id` fijado (RLS): `public_jobs` es legible. Sin modelo ni red. El valor es JSON
 * plano porque el Data Cache lo serializa; la clave lleva el usuario (contiene sus niveles).
 */

/** Skills que se pueden sumar a la simulación a la vez. */
export const MAX_SIMULAR = 5;
/** De las skills del plan se simulan las de mayor prioridad: acota el costo del cálculo. */
const MAX_PLAN_SKILLS = 15;
// v3: la entrada guardada suma `routeSkills`, para rehacer la ruta con `?horas=` afuera del caché
// v4: cada fila suma `evaluatorGaps`
// v5: cada fila suma `examples`
const CACHE_VERSION = "v5";
/** Ventana y tope de las evaluaciones propias que se cuentan para «el evaluador te la marcó». */
const GAP_WINDOW_DAYS = 30;
const MAX_GAP_EVALUATIONS = 500;
const CACHE_REVALIDATE_SECONDS = 30 * 60;
/** Tokens de `?simular=` que entran en la clave del caché (antes de filtrar contra el plan). */
const MAX_REQUESTED_TOKENS = 10;

export type PlanImpactRow = {
  slug: string;
  name: string;
  /** Nivel actual de la persona; null = sin dato. */
  level: number | null;
  asks: number;
  asksMust: number;
  passNow: number;
  passAfter: number;
  delta: number;
  /** Horas que faltan para cerrarla (o 20 si no hay dato). */
  hours: number;
  estimated: boolean;
  /** En cuántas de tus ofertas evaluadas (últimos 30 días) el evaluador la marcó como brecha. */
  evaluatorGaps: number;
  /**
   * Hasta 3 de las ofertas que se te abrirían con la skill (E3d), solo las que ya tenés asignadas:
   * de las demás no hay a dónde llevarte, y queda solo la cuenta.
   */
  examples: { jobId: string; title: string }[];
};

export type PlanImpact = {
  /** Candidatas del pool que pasaron el prefiltro de la persona. */
  total: number;
  /** Cuántas le calzan hoy (pre-score de 7 o más). */
  passNow: number;
  /** Con menos de `SIMULATE_MIN_CANDIDATES` no hay números. */
  enough: boolean;
  /** Fecha del cálculo (ISO), para el pie «ofertas de los últimos 30 días, al …». */
  poolDate: string;
  rows: PlanImpactRow[];
  route: RouteStep[];
  /** Horas por semana con las que está armada `route` (`?horas=`, E4b). */
  hoursPerWeek: number;
  /** false si la entrada no entró en el caché: la ruta queda fija y no se muestra el selector. */
  hoursAdjustable: boolean;
  /** Resultado de `?simular=`: solo las skills que están en el plan; null si no se pidió ninguna. */
  simulation: { slugs: string[]; total: number; passNow: number; passAfter: number } | null;
};

/** Lista de `?simular=a,b` limpia: solo slugs con forma válida, sin repetir, ordenada y acotada. */
export function parseSimular(raw: string | readonly string[] | null | undefined): string[] {
  const text = Array.isArray(raw) ? raw.join(",") : (raw ?? "");
  const tokens = String(text)
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter((t) => /^[a-z0-9_]{1,40}$/.test(t));
  return [...new Set(tokens)].sort().slice(0, MAX_REQUESTED_TOKENS);
}

/** Período de la fuente tal como está en la base; lo desconocido queda en null. */
function periodOf(value: string | null): "mensual" | "anual" | "hora" | null {
  return value === "mensual" || value === "anual" || value === "hora" ? value : null;
}

/**
 * Lo que se guarda en el caché: el impacto base (con la ruta a las horas por defecto) y la entrada
 * del simulador, en arrays (JSON plano), para combinar `?simular=` y `?horas=` afuera. Así cada
 * combinación no repite la consulta del pool.
 */
type CachedImpact = {
  impact: Omit<PlanImpact, "simulation" | "hoursAdjustable">;
  sim: {
    candidates: SimCandidate[];
    levels: [string, number][];
    salaryFloorUsd: number | null;
    planSlugs: string[];
    routeSkills: RouteSkill[];
  } | null;
};

async function computeImpact(userId: string, now: Date): Promise<CachedImpact | null> {
  return withUser(userId, async (tx) => {
    const rules = await loadActiveRules(tx, userId);
    if (!rules) return null;
    const prefs = await loadProfilePrefilterPrefs(tx, userId);

    const levelRows = await tx
      .select({ skillId: s.skillLevels.skillId, slug: s.skills.slug, level: s.skillLevels.level })
      .from(s.skillLevels)
      .innerJoin(s.skills, eq(s.skills.id, s.skillLevels.skillId))
      .where(eq(s.skillLevels.userId, userId));
    // Ojo: `levelBySkill` de la selección va por skillId; `SimInput.levels`, por slug
    const levelBySkill = new Map(levelRows.map((l) => [l.skillId, l.level]));
    const levels = new Map(levelRows.map((l) => [l.slug, l.level]));

    const planRows = await tx
      .select({
        slug: s.skills.slug,
        name: s.skills.name,
        closureHours: s.skills.closureHours,
        aliases: s.skills.aliases,
        priority: s.learningPlanItems.priority,
      })
      .from(s.learningPlanItems)
      .innerJoin(s.skills, eq(s.skills.id, s.learningPlanItems.skillId))
      .where(and(eq(s.learningPlanItems.userId, userId), ne(s.learningPlanItems.status, "cerrada")))
      .orderBy(desc(s.learningPlanItems.priority), s.skills.slug)
      .limit(MAX_PLAN_SKILLS);

    // Las que pasaron el prefiltro, todas (limit = tope de la consulta), en modo persona: incluye
    // las que la persona ya tiene, porque el simulador cuenta ofertas del mercado, no de su bandeja
    const selection = await selectPoolCandidates(tx, {
      userId: null,
      rules,
      prefs,
      levelBySkill,
      now,
      limit: CANDIDATE_CAP,
    });
    const candidates: SimCandidate[] = selection.ranked.map((r) => ({
      id: r.row.id,
      flags: r.flags,
      skills: (selection.skillsByPublicJob.get(r.row.id) ?? []).map((k) => ({
        slug: k.slug,
        name: k.name,
        isMust: k.isMust,
      })),
      // Mensual, como en la bandeja (`poolPreScore`): así «entrar» significa lo mismo
      salaryMaxUsd: monthlyUsd(r.row.salaryMaxUsd, periodOf(r.row.salaryPeriod)),
    }));

    const input: SimInput = {
      candidates,
      levels,
      salaryFloorUsd: rules.salary_floor_usd_monthly ?? null,
    };
    const base = {
      total: candidates.length,
      poolDate: now.toISOString(),
      hoursPerWeek: STUDY_HOURS_DEFAULT,
    };
    if (candidates.length < SIMULATE_MIN_CANDIDATES || planRows.length === 0) {
      return { impact: { ...base, passNow: 0, enough: false, rows: [], route: [] }, sim: null };
    }

    const hoursOf = (closureHours: number | null, level: number | null): number | null => {
      if (closureHours === null) return null;
      const left = Math.round(closureHours * (1 - Math.min(3, level ?? 0) / 3));
      return left > 0 ? left : null;
    };
    const plan = planRows.map((p) => ({
      ...p,
      level: levels.get(p.slug) ?? null,
      hours: hoursOf(p.closureHours, levels.get(p.slug) ?? null),
    }));

    // E4d: la última evaluación de cada oferta propia de los últimos 30 días. Los gaps son texto
    // del modelo: solo pasan por el matcher, contra las skills del plan, y no se muestran. El
    // worker evalúa fuera de una Server Action, así que una evaluación nueva aparece al vencer el
    // caché (30 minutos), como en «Tu encaje»
    const since = new Date(now.getTime() - GAP_WINDOW_DAYS * 86_400_000);
    const gapRows = await tx
      .select({ jobId: s.evaluations.jobId, gaps: s.evaluations.gaps })
      .from(s.evaluations)
      .where(and(eq(s.evaluations.userId, userId), gte(s.evaluations.createdAt, since)))
      .orderBy(desc(s.evaluations.createdAt))
      .limit(MAX_GAP_EVALUATIONS);
    const latestGaps = new Map<string, string[]>();
    for (const g of gapRows) if (!latestGaps.has(g.jobId)) latestGaps.set(g.jobId, g.gaps);
    const gapCounts = countGapMentions(
      [...latestGaps.values()],
      compileTaxonomy(planRows.map((p) => ({ slug: p.slug, name: p.name, aliases: p.aliases }))),
    );

    const impacts = new Map(plan.map((p) => [p.slug, simulateSkillImpact(input, p.slug)]));
    // E3d: de las ofertas del pool que se abrirían, las que la persona ya tiene como `jobs` propios
    const exampleIds = [...new Set([...impacts.values()].flatMap((i) => i.exampleIds))];
    const ownCopies = exampleIds.length
      ? await tx
          .select({ id: s.jobs.id, title: s.jobs.title, publicJobId: s.jobs.publicJobId })
          .from(s.jobs)
          .where(and(eq(s.jobs.userId, userId), inArray(s.jobs.publicJobId, exampleIds)))
      : [];
    const ownByPublic = new Map(ownCopies.map((j) => [j.publicJobId, j]));

    const rows: PlanImpactRow[] = plan.map((p) => {
      const impact = impacts.get(p.slug)!;
      const examples = impact.exampleIds.flatMap((id) => {
        const own = ownByPublic.get(id);
        return own ? [{ jobId: own.id, title: own.title }] : [];
      });
      return {
        slug: p.slug,
        name: p.name,
        level: p.level,
        asks: impact.asks,
        asksMust: impact.asksMust,
        passNow: impact.passNow,
        passAfter: impact.passAfter,
        delta: impact.delta,
        hours: p.hours ?? 20,
        estimated: p.hours === null,
        evaluatorGaps: gapCounts.get(p.slug) ?? 0,
        examples,
      };
    });
    const priorityOf = new Map(plan.map((p, i) => [p.slug, plan.length - i]));
    rows.sort(
      (a, b) =>
        b.delta - a.delta ||
        b.asks - a.asks ||
        (priorityOf.get(b.slug) ?? 0) - (priorityOf.get(a.slug) ?? 0) ||
        a.slug.localeCompare(b.slug),
    );

    const routeSkills: RouteSkill[] = plan.map((p) => ({
      slug: p.slug,
      name: p.name,
      hours: p.hours,
      priority: priorityOf.get(p.slug) ?? 0,
    }));
    const route = buildStudyRoute(input, routeSkills, STUDY_HOURS_DEFAULT);

    return {
      impact: { ...base, passNow: rows[0]?.passNow ?? 0, enough: true, rows, route },
      sim: {
        candidates,
        levels: [...levels],
        salaryFloorUsd: input.salaryFloorUsd,
        planSlugs: plan.map((p) => p.slug),
        routeSkills,
      },
    };
  });
}

/**
 * `?simular=` y `?horas=` sobre la entrada guardada. Simular: solo slugs del plan, hasta 5. Horas:
 * la ruta se rehace si piden otras que las del caché. Sin la entrada (no entró en el caché) queda
 * la ruta guardada, y `hoursPerWeek` sigue diciendo con cuántas horas está armada. Puro y barato.
 */
function withRequest(
  cached: CachedImpact,
  requested: readonly string[],
  hoursPerWeek: number,
): PlanImpact {
  const { sim } = cached;
  if (!sim) return { ...cached.impact, hoursAdjustable: false, simulation: null };
  const input: SimInput = {
    candidates: sim.candidates,
    levels: new Map(sim.levels),
    salaryFloorUsd: sim.salaryFloorUsd,
  };
  const impact = {
    ...cached.impact,
    hoursAdjustable: true,
    ...(hoursPerWeek === cached.impact.hoursPerWeek || !cached.impact.route.length
      ? {}
      : { hoursPerWeek, route: buildStudyRoute(input, sim.routeSkills, hoursPerWeek) }),
  };
  const inPlan = new Set(sim.planSlugs);
  const chosen = requested.filter((slug) => inPlan.has(slug)).slice(0, MAX_SIMULAR);
  if (!chosen.length) return { ...impact, simulation: null };
  return { ...impact, simulation: { slugs: chosen, ...simulateSkills(input, chosen) } };
}

/**
 * Impacto de las skills del plan sobre las ofertas del pool de la persona. Caché por persona de 30
 * minutos. La clave lleva usuario y carrera, pero no `?simular=` ni `?horas=`, que se combinan
 * afuera: así una URL nueva no repite la consulta. La carrera no entra al cálculo (las
 * preferencias salen del perfil), pero va en la clave para que un cambio de carrera no muestre
 * números de la anterior. Guardar
 * niveles o cambiar el estado del plan lo invalida (`invalidateUserInsights`, E-2b). Si falla
 * devuelve `null`: es una ayuda y nunca rompe la página.
 */
export async function getPlanImpact(
  userId: string,
  role: RoleKey | null,
  now: Date,
  simular?: string | readonly string[] | null,
  horas?: string | readonly string[] | null,
): Promise<PlanImpact | null> {
  const requested = parseSimular(simular);
  const hoursPerWeek = parseStudyHours(horas);
  try {
    const cached = await unstable_cache(
      async () => {
        const value = await computeImpact(userId, now);
        // C-7 #11: si no entra en el Data Cache (2 MB), se guarda sin la entrada de `?simular=`:
        // la tabla y la ruta siguen, y la simulación queda sin efecto hasta el próximo cálculo
        return value
          ? fitCacheValue(value, (v) => {
              createLogger({ user_id: userId, task: "plan_impact" }).warn(
                "impacto del plan demasiado grande para el caché: se guarda sin la simulación",
              );
              return { ...v, sim: null };
            })
          : value;
      },
      ["plan-impact", CACHE_VERSION, userId, role ?? "sin-carrera"],
      { revalidate: CACHE_REVALIDATE_SECONDS, tags: [planImpactCacheTag(userId)] },
    )();
    return cached ? withRequest(cached, requested, hoursPerWeek) : null;
  } catch (e) {
    createLogger({ user_id: userId, task: "plan_impact" }).warn(
      { err: safeDbError(e) },
      "no se pudo calcular el impacto del plan",
    );
    return null;
  }
}
