/** Tope de versiones adaptadas con IA por persona en 24 horas. Lo hace cumplir el código, no el modelo. */
export const CV_TAILOR_MAX_PER_DAY = 3;

export type CvTailorStartDecision =
  { ok: true; left: number } | { ok: false; reason: "daily_limit" };

/** `usedLast24h`: pedidos que la persona ya hizo (o tiene en curso) en las últimas 24 horas. */
export function decideCvTailorStart(usedLast24h: number): CvTailorStartDecision {
  if (usedLast24h >= CV_TAILOR_MAX_PER_DAY) return { ok: false, reason: "daily_limit" };
  return { ok: true, left: CV_TAILOR_MAX_PER_DAY - usedLast24h };
}
