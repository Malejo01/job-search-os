import type { AgentCapReason } from "./limits";

/**
 * Medición del asistente por día, sin contenido: de cada charla solo entran números (mensajes,
 * costo, si cortó por tope). Puro: el borde (`apps/web/lib/assistant-metrics.ts`) arma las muestras
 * desde `llm_calls` y trae la fecha; acá no hay I/O ni fecha implícita.
 */

/**
 * Filas marcadoras de `llm_calls` (costo 0, sin tokens, sin contenido) que la ruta escribe para
 * poder medir sin migración: una por turno aceptado y una cuando la charla se corta por un tope.
 * Los pasos del modelo no sirven para esto: hay uno o más por turno y los cortes no dejaban huella.
 *
 * Van con `task = 'assistant_event'` (no es una llamada al modelo: los reportes de gasto la
 * excluyen, como `budget_alert`), `label = conv:<id>`, `model = 'none'`, `ok = true`, `error`
 * null (los conteos de fallos no las ven) y el motivo en `prompt_version`: `turn` o `cap:<motivo>`.
 */
export const ASSISTANT_EVENT_TASK = "assistant_event";
export const ASSISTANT_EVENT_MODEL = "none";
export const ASSISTANT_TURN_MARKER = "turn";
const CAP_PREFIX = "cap:";

/** Motivos que cuentan como «cortó por tope» en la medición (no los errores de entrada de la persona). */
const MEASURED_CAPS: readonly AgentCapReason[] = ["turns", "usd", "steps", "input_tokens"];

export function capMarker(reason: AgentCapReason): string {
  return `${CAP_PREFIX}${reason}`;
}

/** ¿Este motivo de corte deja marcador? */
export function isMeasuredCap(reason: AgentCapReason): boolean {
  return MEASURED_CAPS.includes(reason);
}

export type ConversationSample = {
  /** Cuándo empezó la charla (primera fila de `llm_calls`). */
  startedAt: Date;
  /** Mensajes de la persona que se aceptaron; null = no medido. */
  messages: number | null;
  /** Costo total de la charla; null = alguna llamada sin costo conocido. */
  costUsd: number | null;
  /** La charla se cortó por un tope (turnos, USD, pasos o entrada). */
  capped: boolean;
};

export type AssistantDayMetrics = {
  /** Día calendario `YYYY-MM-DD` en la zona pedida. */
  day: string;
  conversations: number;
  /** Promedio y máximo de mensajes por charla; null si ninguna charla del día tiene el dato. */
  messagesAvg: number | null;
  messagesMax: number | null;
  /** Promedio y percentil 90 del costo por charla; null si ninguna charla tiene costo conocido. */
  costAvgUsd: number | null;
  costP90Usd: number | null;
  /** Charlas con algún costo desconocido (no entran al promedio ni al p90). */
  costUnknown: number;
  cappedConversations: number;
};

const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x) && x >= 0;

export function average(values: readonly number[]): number | null {
  const xs = values.filter(isNum);
  if (xs.length === 0) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/**
 * Percentil por rango más cercano (`ceil(p * n)`-ésimo valor ordenado): con pocos datos devuelve
 * un valor que existió, nunca uno interpolado. `p` en (0, 1]. Sin datos válidos, null.
 */
export function percentile(values: readonly number[], p: number): number | null {
  const xs = values.filter(isNum).sort((a, b) => a - b);
  if (xs.length === 0 || !(p > 0 && p <= 1)) return null;
  const rank = Math.max(1, Math.ceil(p * xs.length));
  return xs[rank - 1] ?? null;
}

const MS_DAY = 24 * 60 * 60 * 1000;

/** `YYYY-MM-DD` de un instante, desplazado `offsetMinutes` respecto de UTC (Argentina: -180). */
export function dayKey(at: Date, offsetMinutes: number): string {
  return new Date(at.getTime() + offsetMinutes * 60_000).toISOString().slice(0, 10);
}

/**
 * Una fila por cada uno de los últimos `days` días (incluido el de `now`), del más reciente al más
 * viejo, también los días sin charlas (para que un cero se vea y no parezca un dato perdido).
 */
export function aggregateAssistantDays(
  samples: readonly ConversationSample[],
  now: Date,
  opts: { days?: number; offsetMinutes?: number } = {},
): AssistantDayMetrics[] {
  const days = Math.max(1, Math.floor(opts.days ?? 7));
  const offset = opts.offsetMinutes ?? 0;
  const byDay = new Map<string, ConversationSample[]>();
  for (let i = 0; i < days; i++)
    byDay.set(dayKey(new Date(now.getTime() - i * MS_DAY), offset), []);
  for (const s of samples) byDay.get(dayKey(s.startedAt, offset))?.push(s);

  return [...byDay.entries()].map(([day, list]) => {
    const messages = list.map((s) => s.messages).filter(isNum);
    const costs = list.map((s) => s.costUsd).filter(isNum);
    return {
      day,
      conversations: list.length,
      messagesAvg: average(messages),
      messagesMax: messages.length ? Math.max(...messages) : null,
      costAvgUsd: average(costs),
      costP90Usd: percentile(costs, 0.9),
      costUnknown: list.length - costs.length,
      cappedConversations: list.filter((s) => s.capped).length,
    };
  });
}
