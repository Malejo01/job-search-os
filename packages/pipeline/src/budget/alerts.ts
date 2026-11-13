/**
 * Alertas de presupuesto de LLM (R7-1). Puro: sin I/O ni reloj. Decide qué umbrales del tope diario
 * (`LLM_DAILY_CAP_USD`) se pasaron y arma el texto del aviso. Quién lo manda y dónde se recuerda que ya se
 * mandó (una vez por umbral y por día) es de `adapters/llm/budget-alerts.ts`.
 */

/** Porcentajes del tope diario en los que se avisa a los admins. */
export const BUDGET_ALERT_THRESHOLDS = [70, 85, 95] as const;
export type BudgetAlertThreshold = (typeof BUDGET_ALERT_THRESHOLDS)[number];

/**
 * Umbrales pasados que todavía no se avisaron, de menor a mayor. Sin tope (0, negativo o no finito) o con un
 * gasto inválido no hay nada que avisar. Si el gasto saltó varios umbrales de golpe, vuelven todos: el
 * llamador los marca juntos y manda un solo email por el más alto.
 */
export function crossedThresholds(
  spentUsd: number,
  capUsd: number,
  alreadySent: readonly number[],
): BudgetAlertThreshold[] {
  if (!Number.isFinite(spentUsd) || !Number.isFinite(capUsd) || capUsd <= 0 || spentUsd < 0) {
    return [];
  }
  const sent = new Set(alreadySent);
  return BUDGET_ALERT_THRESHOLDS.filter(
    // El margen absorbe el redondeo de flotante en el borde (0,7 × 3 no da 2,1 exacto)
    (t) => !sent.has(t) && spentUsd * 100 >= t * capUsd * (1 - 1e-9),
  );
}

/** Día de la alerta: la fecha UTC (`YYYY-MM-DD`), la misma ventana en la que Resend cuenta su límite. */
export function budgetAlertDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** Clave de idempotencia de Resend: refuerzo de la marca en base, una por día, umbral y destinatario. */
export function budgetAlertIdempotencyKey(
  day: string,
  threshold: number,
  recipient: number,
): string {
  return `budget-alert:${day}:${threshold}:${recipient}`;
}

/** Destinatarios desde `ADMIN_EMAILS` (separados por coma): recortados, sin vacíos ni repetidos. */
export function parseAlertRecipients(raw: string | undefined): string[] {
  const out: string[] = [];
  for (const part of (raw ?? "").split(",")) {
    const email = part.trim().toLowerCase();
    if (email && !out.includes(email)) out.push(email);
  }
  return out;
}

const money = (n: number) =>
  n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Aviso corto: solo montos agregados y el link a la pantalla de salud. Nada de datos de personas. */
export function buildBudgetAlertEmail(input: {
  threshold: number;
  spentUsd: number;
  capUsd: number;
  adminUrl: string;
}): { subject: string; text: string } {
  const { threshold, spentUsd, capUsd, adminUrl } = input;
  const lines = [
    `El gasto de IA de las últimas 24 horas llegó al ${threshold} % del tope diario.`,
    "",
    `Gastado: USD ${money(spentUsd)} de USD ${money(capUsd)}.`,
  ];
  if (threshold >= 95) {
    lines.push("Al llegar al tope se frena la evaluación de ofertas hasta que baje el gasto.");
  }
  lines.push("", `Detalle: ${adminUrl}`);
  return {
    subject: `Gasto de IA al ${threshold} % del tope diario`,
    text: lines.join("\n"),
  };
}
