/**
 * Topes de la ficha del aviso (R31-03, ADR-048). Puro: decide con números que le pasa la capa de adapters.
 *
 * La ficha no es de nadie (se genera una vez por texto), así que sus topes no son por persona: hay un tope diario
 * de fichas y otro de gasto, propios, además del tope global de gasto de todos (que se mide aparte).
 * Al llegar al tope la pantalla lo dice y el resto de la app sigue.
 */

export const JOB_CARD_TASK = "extract_job_card";
/** Versión del prompt (frontmatter de `packages/prompts/extract_job_card.v1.md`). */
export const JOB_CARD_PROMPT = "extract_job_card@v1";
export const JOB_CARD_LABEL_PREFIX = "job_card:";

/** Etiqueta de la fila de reserva y de las filas de `llm_calls` de una ficha: el hash, nunca una persona. */
export const jobCardReservationLabel = (hash: string): string => `${JOB_CARD_LABEL_PREFIX}${hash}`;

/**
 * Valores por defecto, bajos a propósito: unos 100 avisos nuevos al día alcanzan para la beta y, con Haiku (unos
 * USD 0,01 por ficha), cuestan menos de USD 1. Se suben con las variables de entorno cuando haga falta.
 */
export const JOB_CARD_DEFAULT_DAILY_MAX = 100;
export const JOB_CARD_DEFAULT_DAILY_USD = 1;

/** Intentos por texto: una ficha fallida se puede reintentar hasta acá; después queda fallida. */
export const JOB_CARD_MAX_ATTEMPTS = 3;

export type JobCardCaps = { dailyMax: number; dailyUsd: number };

/**
 * `JOB_CARD_DAILY_MAX` (entero ≥ 0) y `JOB_CARD_DAILY_USD` (≥ 0). Un valor vacío usa el default; uno inválido
 * también y se informa. A diferencia de otros topes, **0 no desactiva el tope: significa «ninguna ficha nueva»**.
 */
export function jobCardCapsFromEnv(env: Record<string, string | undefined>): {
  caps: JobCardCaps;
  invalid: string[];
} {
  const invalid: string[] = [];
  const read = (name: string, fallback: number, integer: boolean): number => {
    const raw = env[name]?.trim();
    if (raw === undefined || raw === "") return fallback;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0 || (integer && !Number.isInteger(n))) {
      invalid.push(name);
      return fallback;
    }
    return n;
  };
  return {
    caps: {
      dailyMax: read("JOB_CARD_DAILY_MAX", JOB_CARD_DEFAULT_DAILY_MAX, true),
      dailyUsd: read("JOB_CARD_DAILY_USD", JOB_CARD_DEFAULT_DAILY_USD, false),
    },
    invalid,
  };
}

export type JobCardStartInput = {
  caps: JobCardCaps;
  /** Fichas intentadas en las últimas 24 h (una por texto). */
  cardsLast24h: number;
  /** USD gastados en fichas en las últimas 24 h. */
  usdLast24h: number;
  /** Fichas en curso ahora (reservas vivas) y su estimado. */
  reservedCount: number;
  reservedUsd: number;
  /** Lo que se va a reservar para esta. */
  estimateUsd: number;
};

export type JobCardStartDecision =
  { ok: true } | { ok: false; reason: "daily_count" | "daily_usd" };

export function decideJobCardStart(input: JobCardStartInput): JobCardStartDecision {
  const { caps } = input;
  const numbers = [
    input.cardsLast24h,
    input.usdLast24h,
    input.reservedCount,
    input.reservedUsd,
    input.estimateUsd,
  ];
  // Un número raro frena: nunca se abre el gasto por un dato ilegible
  if (numbers.some((n) => !Number.isFinite(n))) return { ok: false, reason: "daily_usd" };
  if (input.cardsLast24h + input.reservedCount + 1 > caps.dailyMax) {
    return { ok: false, reason: "daily_count" };
  }
  if (input.usdLast24h + input.reservedUsd + input.estimateUsd > caps.dailyUsd) {
    return { ok: false, reason: "daily_usd" };
  }
  return { ok: true };
}

/** ¿Se puede volver a pedir una ficha fallida? Solo las `fallida` y hasta `JOB_CARD_MAX_ATTEMPTS` intentos. */
export function canRetryJobCard(row: { status: string; attempts: number }): boolean {
  return row.status === "fallida" && row.attempts < JOB_CARD_MAX_ATTEMPTS;
}
