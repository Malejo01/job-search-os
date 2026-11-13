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

/**
 * Clave de idempotencia de Resend: una por día, umbral y destinatario. Usa el id estable del destinatario
 * (hash de su email, lo calcula el adapter), no su posición: si cambia `ADMIN_EMAILS` la clave de los demás no cambia.
 * Es lo que evita el doble envío si el proceso muere entre mandar y anotar (R8-5).
 */
export function budgetAlertIdempotencyKey(
  day: string,
  threshold: number,
  recipientId: string,
): string {
  return `budget-alert:${day}:${threshold}:${recipientId}`;
}

/** Aviso ya entregado. `recipientId` null = marca de R7-1 (una por umbral, valía para todos). */
export type BudgetAlertMark = { recipientId: string | null; threshold: number };
export type BudgetAlertPlan = {
  recipientId: string;
  /** Umbrales cruzados que a esta persona todavía no se le avisaron. */
  thresholds: BudgetAlertThreshold[];
  /** El más alto: un solo email por destinatario, por ese. */
  top: BudgetAlertThreshold;
};

/**
 * Qué mandar y a quién: por destinatario, los umbrales cruzados que todavía no recibió. Así un envío parcial
 * se reintenta solo para el que falló. Los destinatarios salen en el orden recibido.
 */
export function planBudgetAlerts(input: {
  spentUsd: number;
  capUsd: number;
  recipientIds: readonly string[];
  marks: readonly BudgetAlertMark[];
}): BudgetAlertPlan[] {
  const plans: BudgetAlertPlan[] = [];
  for (const recipientId of input.recipientIds) {
    const done = input.marks
      .filter((m) => m.recipientId === null || m.recipientId === recipientId)
      .map((m) => m.threshold);
    const thresholds = crossedThresholds(input.spentUsd, input.capUsd, done);
    if (thresholds.length > 0) {
      plans.push({ recipientId, thresholds, top: thresholds[thresholds.length - 1]! });
    }
  }
  return plans;
}

/** Entre dos consultas de las evaluaciones fuera del cron (por instancia). */
export const BUDGET_ALERT_RECHECK_MS = 5 * 60_000;

/**
 * Memo en memoria del proceso para revisar el umbral desde las evaluaciones sin sumar consultas. En serverless es
 * por instancia: la que arranca en frío consulta una vez. La marca en base sigue siendo la que garantiza «una
 * vez por umbral, por destinatario y por día».
 */
export type BudgetAlertMemo = { day: string; doneTop: number; checkedAtMs: number };

/** false = no hace falta consultar nada: el día ya está completo, o se miró hace menos de 5 minutos. */
export function shouldCheckBudgetAlerts(memo: BudgetAlertMemo | null, now: Date): boolean {
  if (!memo || memo.day !== budgetAlertDay(now)) return true;
  if (memo.doneTop >= Math.max(...BUDGET_ALERT_THRESHOLDS)) return false;
  return now.getTime() - memo.checkedAtMs >= BUDGET_ALERT_RECHECK_MS;
}

/**
 * Memo tras una revisión. `crossedTop`: el umbral más alto que cruzó el gasto (0 si ninguno); `complete`: todos
 * los destinatarios lo recibieron. Con un fallo `doneTop` queda en 0: no se da por cumplido.
 */
export function nextBudgetAlertMemo(
  day: string,
  now: Date,
  result: { crossedTop: number; complete: boolean },
): BudgetAlertMemo {
  return {
    day,
    doneTop: result.complete ? result.crossedTop : 0,
    checkedAtMs: now.getTime(),
  };
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
