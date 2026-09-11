/**
 * Agenda de mercado (adelanto de JS-031, sin LLM): demanda ponderada por skill y cruce con el
 * nivel del usuario. Funciones puras: reciben ofertas ya cargadas y devuelven filas listas para
 * `market_snapshots` y para la página /market.
 */
export type JobSkillsInput = {
  jobId: string;
  /** Score de la oferta (última evaluación); null = sin evaluar. */
  score: number | null;
  skills: readonly { slug: string; isMust: boolean }[];
};

export type SkillDemand = {
  slug: string;
  mentions: number;
  mustMentions: number;
  /** Σ score_oferta × (must ? 1 : 0.4). Las ofertas sin score pesan `defaultScore`. */
  weightedDemand: number;
};

export const OPTIONAL_WEIGHT = 0.4;

export function computeDemand(
  jobs: readonly JobSkillsInput[],
  options: { defaultScore?: number } = {},
): SkillDemand[] {
  const defaultScore = options.defaultScore ?? 5;
  const acc = new Map<string, SkillDemand>();
  for (const job of jobs) {
    const score = job.score ?? defaultScore;
    for (const sk of job.skills) {
      const d = acc.get(sk.slug) ?? {
        slug: sk.slug,
        mentions: 0,
        mustMentions: 0,
        weightedDemand: 0,
      };
      d.mentions += 1;
      if (sk.isMust) d.mustMentions += 1;
      d.weightedDemand += score * (sk.isMust ? 1 : OPTIONAL_WEIGHT);
      acc.set(sk.slug, d);
    }
  }
  return [...acc.values()]
    .map((d) => ({ ...d, weightedDemand: Math.round(d.weightedDemand * 100) / 100 }))
    .sort((a, b) => b.weightedDemand - a.weightedDemand || a.slug.localeCompare(b.slug));
}

/** Nivel del usuario: 0 nulo · 1 básico · 2 productivo · 3 fuerte (skill_levels). */
export type SkillLevelInput = { slug: string; level: number };

export type AgendaRow = SkillDemand & { level: number | null };

export type MarketAgenda = {
  /** Demanda alta y nivel ≤ 1: lo que falta. Orden: demanda ponderada desc. */
  gaps: AgendaRow[];
  /** Nivel 3 con demanda: lo que diferencia. */
  differentials: AgendaRow[];
  /** Nivel 2: productivo pero no fuerte; candidatos a subir. */
  growing: AgendaRow[];
  /** Todo, para la tabla completa. */
  all: AgendaRow[];
};

export function buildAgenda(
  demand: readonly SkillDemand[],
  levels: readonly SkillLevelInput[],
  options: { minMentions?: number } = {},
): MarketAgenda {
  const minMentions = options.minMentions ?? 2;
  const levelBySlug = new Map(levels.map((l) => [l.slug, l.level]));
  const all: AgendaRow[] = demand.map((d) => ({ ...d, level: levelBySlug.get(d.slug) ?? null }));
  const relevant = all.filter((r) => r.mentions >= minMentions);
  return {
    gaps: relevant.filter((r) => (r.level ?? 0) <= 1),
    differentials: all.filter((r) => r.level === 3),
    growing: relevant.filter((r) => r.level === 2),
    all,
  };
}

/** Lunes (UTC) de la semana de una fecha, como YYYY-MM-DD: clave de market_snapshots.week_start. */
export function weekStartOf(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay(); // 0 domingo
  d.setUTCDate(d.getUTCDate() - ((day + 6) % 7));
  return d.toISOString().slice(0, 10);
}
