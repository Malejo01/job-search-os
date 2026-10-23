import { schema as s } from "@job-search-os/db";
import {
  buildFitSummary,
  type CareerMarket,
  type Checklist,
  type FitOffer,
  type FitSummary,
  type RoleKey,
} from "@job-search-os/pipeline";
import { and, desc, eq, gte, inArray, isNull } from "drizzle-orm";
import { unstable_cache } from "next/cache";
import { getCareerMarket } from "./career-market";
import { withUser } from "./db";
import { parseChecklist } from "./job-detail";

/**
 * Datos de «Tu encaje» (C-6, ticket E2). Lee con RLS (`withUser`) la última evaluación de cada oferta
 * de los últimos 30 días (tope 200, sin duplicados fusionados), sus skills y los niveles de la
 * persona, y se los pasa a `buildFitSummary` del pipeline. Sin LLM.
 */

/** Ventana de ofertas que cuentan, en días, y tope de ofertas (diseño §1.4 y D2). */
export const FIT_WINDOW_DAYS = 30;
export const FIT_MAX_OFFERS = 200;
/** Caché por persona: 15 minutos. */
export const FIT_REVALIDATE_SECONDS = 15 * 60;

const DAY_MS = 24 * 60 * 60 * 1000;
/** Evaluaciones que se leen para llegar a 200 ofertas distintas (una oferta puede tener varias). */
const EVALUATION_ROWS_CAP = 600;

export type FitData = {
  role: RoleKey;
  windowDays: number;
  summary: FitSummary;
  /** Ofertas de la ventana cuya evaluación es anterior al checklist: no cuentan para los requisitos. */
  withoutChecklist: number;
  /** Cuántos niveles de skills cargó la persona (0 = todavía no cargó ninguno). */
  levelsCount: number;
  /** Mercado público de la carrera; viene siempre, la página mira `total` para el vacío. */
  market: CareerMarket;
  /** Solo lo que necesita el bloque «Tu carrera en el mercado». */
  profile: { englishCefr: string | null; country: string };
};

async function readFitData(userId: string, role: RoleKey, now: Date): Promise<FitData> {
  const since = new Date(now.getTime() - FIT_WINDOW_DAYS * DAY_MS);
  const market = await getCareerMarket(role);
  const marketShare =
    market.total > 0 ? new Map(market.skills.map((k) => [k.slug, k.share])) : null;

  const raw = await withUser(userId, async (tx) => {
    // Más nuevas primero: la primera fila de cada oferta es su última evaluación
    const evals = await tx
      .select({ jobId: s.evaluations.jobId, decision: s.evaluations.decision })
      .from(s.evaluations)
      .innerJoin(s.jobs, eq(s.jobs.id, s.evaluations.jobId))
      .where(
        and(
          eq(s.evaluations.userId, userId),
          gte(s.evaluations.createdAt, since),
          isNull(s.jobs.duplicateOfId),
        ),
      )
      .orderBy(desc(s.evaluations.createdAt))
      .limit(EVALUATION_ROWS_CAP);
    const latest = new Map<string, unknown>();
    for (const e of evals) {
      if (latest.size >= FIT_MAX_OFFERS) break;
      if (!latest.has(e.jobId)) latest.set(e.jobId, e.decision);
    }
    const jobIds = [...latest.keys()];
    const [asked, levels, profileRows] = await Promise.all([
      jobIds.length === 0
        ? Promise.resolve([])
        : tx
            .select({
              jobId: s.jobSkills.jobId,
              slug: s.skills.slug,
              name: s.skills.name,
              isMust: s.jobSkills.isMust,
            })
            .from(s.jobSkills)
            .innerJoin(s.skills, eq(s.skills.id, s.jobSkills.skillId))
            .where(inArray(s.jobSkills.jobId, jobIds)),
      tx
        .select({ slug: s.skills.slug, name: s.skills.name, level: s.skillLevels.level })
        .from(s.skillLevels)
        .innerJoin(s.skills, eq(s.skills.id, s.skillLevels.skillId))
        .where(eq(s.skillLevels.userId, userId)),
      tx
        .select({ cefr: s.profiles.englishCefr, country: s.profiles.locationCountry })
        .from(s.profiles)
        .where(eq(s.profiles.userId, userId))
        .limit(1),
    ]);
    return { latest, asked, levels, profile: profileRows[0] ?? null };
  });

  const skillNames = new Map<string, string>();
  const skillsByJob = new Map<string, { slug: string; isMust: boolean }[]>();
  for (const row of raw.asked) {
    skillNames.set(row.slug, row.name);
    const list = skillsByJob.get(row.jobId) ?? [];
    list.push({ slug: row.slug, isMust: row.isMust });
    skillsByJob.set(row.jobId, list);
  }
  for (const row of raw.levels) skillNames.set(row.slug, row.name);

  const offers: FitOffer[] = [...raw.latest].map(([jobId, decision]) => ({
    // `parseChecklist` valida la forma al leer; el tipo del pipeline es más estrecho (ids literales)
    checklist: parseChecklist(decision) as Checklist | null,
    skills: skillsByJob.get(jobId) ?? [],
  }));
  const summary = buildFitSummary({
    offers,
    levels: new Map(raw.levels.map((l) => [l.slug, l.level])),
    skillNames,
    marketShare,
  });
  return {
    role,
    windowDays: FIT_WINDOW_DAYS,
    summary,
    withoutChecklist: summary.basis.offers - summary.basis.withChecklist,
    levelsCount: raw.levels.length,
    market,
    profile: { englishCefr: raw.profile?.cefr ?? null, country: raw.profile?.country ?? "" },
  };
}

/**
 * «Tu encaje» de una persona para una carrera. Caché de 15 minutos con el `userId` y la carrera en la
 * clave: es dato personal y nunca se comparte entre personas. Sin invalidación (invalidar exigiría
 * tocar acciones de otras pantallas): lo que cargues se ve en el próximo cálculo. El valor es JSON plano.
 * `now` solo se usa al recalcular, por eso no entra en la clave.
 */
export function getFitData(userId: string, role: RoleKey, now: Date): Promise<FitData> {
  return unstable_cache(() => readFitData(userId, role, now), ["fit", "v1", userId, role], {
    revalidate: FIT_REVALIDATE_SECONDS,
    tags: [`fit:${userId}`],
  })();
}
