import { schema as s } from "@job-search-os/db";
import { buildAgenda, skillCandidates, type MarketAgenda } from "@job-search-os/pipeline";
import { and, count, desc, eq, gte, isNotNull, lte } from "drizzle-orm";
import { revalidateTag, unstable_cache } from "next/cache";
import { withUser } from "./db";
import { candidatesCacheConfig } from "./market-cache";

/**
 * Agenda de mercado (/market, adelanto de JS-031): lee el snapshot más reciente dentro del rango
 * de semanas pedido y lo cruza con skill_levels del usuario. Sin LLM; buildAgenda es pura.
 */
export type MarketView = {
  weekStart: string | null;
  weeks: string[];
  agenda: MarketAgenda;
  skills: Record<string, { name: string; category: string; closureHours: number | null }>;
  levelsKnown: number;
  /** Términos frecuentes fuera de la taxonomía (`skillCandidates` sobre los últimos 300 JD). */
  candidates: SkillCandidate[];
};

export type SkillCandidate = { term: string; count: number };

export type MarketRange = { from: string | null; to: string | null };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export function parseRange(params: Record<string, string | string[] | undefined>): MarketRange {
  const one = (k: string) => {
    const v = params[k];
    const x = (Array.isArray(v) ? v[0] : v) ?? "";
    return DATE_RE.test(x) ? x : null;
  };
  return { from: one("desde"), to: one("hasta") };
}

/**
 * Candidatos: términos frecuentes en los JD recientes que la taxonomía no cubre (propuesta).
 * Sin caché; consulta con su propia transacción `withUser` (RLS).
 */
async function computeCandidates(userId: string): Promise<SkillCandidate[]> {
  return withUser(userId, async (tx) => {
    const taxonomyRows = await tx
      .select({ slug: s.skills.slug, name: s.skills.name, aliases: s.skills.aliases })
      .from(s.skills);
    const jdRows = await tx
      .select({
        jdText: s.jobs.jdText,
        companyRaw: s.jobs.companyRaw,
        companyName: s.companies.nameNormalized,
      })
      .from(s.jobs)
      .leftJoin(s.companies, eq(s.companies.id, s.jobs.companyId))
      .where(isNotNull(s.jobs.jdText))
      .orderBy(desc(s.jobs.createdAt))
      .limit(300);
    // Los nombres de empresa no son skills: se excluyen de los candidatos.
    const exclude = [
      ...new Set(
        jdRows.flatMap((j) => [j.companyRaw, j.companyName].filter((n): n is string => !!n)),
      ),
    ];
    return skillCandidates(
      jdRows.flatMap((j) => (j.jdText ? [j.jdText] : [])),
      taxonomyRows,
      { limit: 15, exclude },
    ).map(({ term, count }) => ({ term, count }));
  });
}

/** Cacheado por usuario (clave y tag incluyen `userId`: nunca se comparte entre usuarios). */
function getCandidates(userId: string): Promise<SkillCandidate[]> {
  const { keyParts, tags, revalidate } = candidatesCacheConfig(userId);
  return unstable_cache(() => computeCandidates(userId), keyParts, { revalidate, tags })();
}

/**
 * Invalida el caché de candidatos del usuario. Se llama desde las Server Actions de alta manual,
 * pegado de JD y borrado de cuenta. La ingesta del cron/email corre fuera de Next y no puede
 * invalidar: ahí el caché vence solo (1 h).
 */
export function invalidateMarketCandidates(userId: string): void {
  for (const tag of candidatesCacheConfig(userId).tags) revalidateTag(tag);
}

/** Lo mínimo para decidir qué pantalla vacía mostrar en /market y /plan. */
export type DataState = {
  jobsCount: number;
  hasSnapshot: boolean;
  levelsKnown: number;
  /**
   * Hay ofertas, no hay snapshot y el último recálculo fue hace más de 5 minutos: el cálculo ya
   * corrió y no encontró skills en las ofertas (no es que siga en curso).
   */
  noSkillsFound: boolean;
};

const STALE_RECOMPUTE_MS = 5 * 60_000;

/**
 * Los `count()` y `select` van sin filtro de usuario a propósito: se apoyan en RLS (`withUser`
 * fija el usuario de la transacción y las tablas tienen política de dueño).
 */
export async function getDataState(userId: string): Promise<DataState> {
  return withUser(userId, async (tx) => {
    const [jobs] = await tx.select({ n: count() }).from(s.jobs);
    const snap = await tx.select({ id: s.marketSnapshots.id }).from(s.marketSnapshots).limit(1);
    const [levels] = await tx.select({ n: count() }).from(s.skillLevels);
    const [mark] = await tx
      .select({ createdAt: s.jobQueue.createdAt })
      .from(s.jobQueue)
      .where(eq(s.jobQueue.queue, "market_recompute"))
      .orderBy(desc(s.jobQueue.createdAt))
      .limit(1);
    const jobsCount = jobs?.n ?? 0;
    const hasSnapshot = snap.length > 0;
    return {
      jobsCount,
      hasSnapshot,
      levelsKnown: levels?.n ?? 0,
      noSkillsFound:
        jobsCount > 0 &&
        !hasSnapshot &&
        mark !== undefined &&
        Date.now() - mark.createdAt.getTime() > STALE_RECOMPUTE_MS,
    };
  });
}

export async function getMarket(userId: string, range: MarketRange): Promise<MarketView> {
  // Fuera de la transacción de abajo: el caché abre la suya y no debe anidarse (otra conexión).
  const candidates = await getCandidates(userId);
  return withUser(userId, async (tx) => {
    const weekRows = await tx
      .selectDistinct({ weekStart: s.marketSnapshots.weekStart })
      .from(s.marketSnapshots)
      .orderBy(desc(s.marketSnapshots.weekStart));
    const weeks = weekRows.map((w) => w.weekStart);
    const conds = [
      range.from ? gte(s.marketSnapshots.weekStart, range.from) : undefined,
      range.to ? lte(s.marketSnapshots.weekStart, range.to) : undefined,
    ].filter((c): c is NonNullable<typeof c> => c !== undefined);
    const [latest] = await tx
      .select({ weekStart: s.marketSnapshots.weekStart })
      .from(s.marketSnapshots)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(s.marketSnapshots.weekStart))
      .limit(1);
    const weekStart = latest?.weekStart ?? null;

    const levelRows = await tx
      .select({ slug: s.skills.slug, level: s.skillLevels.level })
      .from(s.skillLevels)
      .innerJoin(s.skills, eq(s.skills.id, s.skillLevels.skillId));
    const skillRows = await tx
      .select({
        slug: s.skills.slug,
        name: s.skills.name,
        category: s.skills.category,
        closureHours: s.skills.closureHours,
      })
      .from(s.skills);
    const skills = Object.fromEntries(
      skillRows.map((k) => [
        k.slug,
        { name: k.name, category: k.category, closureHours: k.closureHours },
      ]),
    );

    if (!weekStart) {
      return {
        weekStart,
        weeks,
        agenda: buildAgenda([], levelRows),
        skills,
        levelsKnown: levelRows.length,
        candidates,
      };
    }
    const rows = await tx
      .select({
        slug: s.skills.slug,
        mentions: s.marketSnapshots.mentions,
        mustMentions: s.marketSnapshots.mustMentions,
        weightedDemand: s.marketSnapshots.weightedDemand,
      })
      .from(s.marketSnapshots)
      .innerJoin(s.skills, eq(s.skills.id, s.marketSnapshots.skillId))
      .where(eq(s.marketSnapshots.weekStart, weekStart))
      .orderBy(desc(s.marketSnapshots.weightedDemand));
    return {
      weekStart,
      weeks,
      agenda: buildAgenda(rows, levelRows),
      skills,
      levelsKnown: levelRows.length,
      candidates,
    };
  });
}
