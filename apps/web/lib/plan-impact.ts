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
  buildStudyRoute,
  monthlyUsd,
  simulateSkillImpact,
  simulateSkills,
  type RoleKey,
  type RouteStep,
  type SimCandidate,
  type SimInput,
} from "@job-search-os/pipeline";
import { and, desc, eq, ne } from "drizzle-orm";
import { unstable_cache } from "next/cache";
import { withUser } from "./db";

/**
 * «Si aprendés…» de /plan (ronda 121, E3b): cuántas ofertas del pool te empezarían a calzar si
 * llevás una skill del plan a nivel 2, y en qué orden conviene estudiarlas. Corre con el rol de la
 * app y `app.user_id` fijado (RLS): `public_jobs` es legible. Sin modelo ni red. El valor es JSON
 * plano porque el Data Cache lo serializa; la clave lleva el usuario (contiene sus niveles).
 */

/** Skills que se pueden sumar a la simulación a la vez. */
export const MAX_SIMULAR = 5;
/** Horas de estudio por semana de la ruta: fijas hasta que exista el selector (E4). */
export const PLAN_IMPACT_HOURS_PER_WEEK = 5;
/** De las skills del plan se simulan las de mayor prioridad: acota el costo del cálculo. */
const MAX_PLAN_SKILLS = 15;
const CACHE_VERSION = "v1";
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
  hoursPerWeek: number;
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

async function computeImpact(
  userId: string,
  now: Date,
  requested: readonly string[],
): Promise<PlanImpact | null> {
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
      hoursPerWeek: PLAN_IMPACT_HOURS_PER_WEEK,
    };
    if (candidates.length < SIMULATE_MIN_CANDIDATES || planRows.length === 0) {
      return { ...base, passNow: 0, enough: false, rows: [], route: [], simulation: null };
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

    const rows: PlanImpactRow[] = plan.map((p) => {
      const impact = simulateSkillImpact(input, p.slug);
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

    const route = buildStudyRoute(
      input,
      plan.map((p) => ({
        slug: p.slug,
        name: p.name,
        hours: p.hours,
        priority: priorityOf.get(p.slug) ?? 0,
      })),
      PLAN_IMPACT_HOURS_PER_WEEK,
    );

    const inPlan = new Set(plan.map((p) => p.slug));
    const chosen = requested.filter((slug) => inPlan.has(slug)).slice(0, MAX_SIMULAR);
    const simulation = chosen.length ? { slugs: chosen, ...simulateSkills(input, chosen) } : null;

    return {
      ...base,
      passNow: rows[0]?.passNow ?? 0,
      enough: true,
      rows,
      route,
      simulation,
    };
  });
}

/**
 * Impacto de las skills del plan sobre las ofertas del pool de la persona. Caché por persona de 30
 * minutos (la clave lleva usuario, carrera y `?simular=`). Si falla devuelve `null`: es una ayuda y
 * nunca rompe la página.
 */
export async function getPlanImpact(
  userId: string,
  role: RoleKey | null,
  now: Date,
  simular?: string | readonly string[] | null,
): Promise<PlanImpact | null> {
  const requested = parseSimular(simular);
  try {
    return await unstable_cache(
      () => computeImpact(userId, now, requested),
      ["plan-impact", CACHE_VERSION, userId, role ?? "sin-carrera", requested.join(",")],
      { revalidate: CACHE_REVALIDATE_SECONDS, tags: [`plan-impact:${userId}`] },
    )();
  } catch (e) {
    createLogger({ user_id: userId, task: "plan_impact" }).warn(
      { err: safeDbError(e) },
      "no se pudo calcular el impacto del plan",
    );
    return null;
  }
}
