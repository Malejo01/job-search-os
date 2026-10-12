/** Horas de trabajo de un mes, para llevar un monto por hora a mensual. */
export const HOURS_PER_MONTH = 160;

/**
 * Lleva un monto en USD a mensual para compararlo con el piso del perfil (`salary_floor_usd`, que es
 * mensual). Sin monto o con un período que no se conoce devuelve `null`: no se supone mensual,
 * porque un anual leído como mensual pasaría cualquier piso.
 */
export function monthlyUsd(
  amount: number | null,
  period: "mensual" | "anual" | "hora" | null | undefined,
): number | null {
  if (amount === null || !Number.isFinite(amount)) return null;
  switch (period) {
    case "mensual":
      return Math.round(amount);
    case "anual":
      return Math.round(amount / 12);
    case "hora":
      return Math.round(amount * HOURS_PER_MONTH);
    default:
      return null;
  }
}
