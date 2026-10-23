import { revalidateTag } from "next/cache";

/** Tags del caché por persona: los usan `lib/fit.ts`, `lib/plan-impact.ts` y la invalidación. */
export const fitCacheTag = (userId: string): string => `fit:${userId}`;
export const planImpactCacheTag = (userId: string): string => `plan-impact:${userId}`;

/**
 * Invalida los cálculos por persona que dependen de sus niveles, su plan, sus criterios y sus
 * ofertas: «Tu encaje» (15 min) y «Si aprendés…» (30 min). E-2b: sin esto, lo que se guardaba se
 * veía recién cuando el caché vencía solo. Solo vale dentro de una Server Action o un route handler
 * (Next lo exige para `revalidateTag`); la ingesta del cron corre fuera y no puede llamarlo.
 */
export function invalidateUserInsights(userId: string): void {
  revalidateTag(fitCacheTag(userId));
  revalidateTag(planImpactCacheTag(userId));
}
