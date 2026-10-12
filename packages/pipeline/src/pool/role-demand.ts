import { computeDemand } from "../skills/market";

export type RoleDemandJob = { skills: readonly { slug: string; isMust: boolean }[] };
export type RoleDemandRow = { slug: string; mentions: number; mustMentions: number };

/**
 * Demanda de skills de un rol a partir de sus avisos del pool: menciones y menciones obligatorias,
 * sin ponderar por score (los avisos del pool no tienen evaluación). Una skill repetida dentro de
 * un mismo aviso cuenta una vez, y es obligatoria si alguna mención lo es. Orden: menciones desc,
 * obligatorias desc, slug.
 */
export function roleDemand(jobs: readonly RoleDemandJob[]): RoleDemandRow[] {
  const deduped = jobs.map((job, i) => {
    const bySlug = new Map<string, boolean>();
    for (const sk of job.skills) bySlug.set(sk.slug, (bySlug.get(sk.slug) ?? false) || sk.isMust);
    return {
      jobId: String(i),
      score: null,
      skills: [...bySlug].map(([slug, isMust]) => ({ slug, isMust })),
    };
  });
  return computeDemand(deduped)
    .map(({ slug, mentions, mustMentions }) => ({ slug, mentions, mustMentions }))
    .sort(
      (a, b) =>
        b.mentions - a.mentions || b.mustMentions - a.mustMentions || a.slug.localeCompare(b.slug),
    );
}
