/**
 * Topes por persona y de entrada para lo que cargan a mano la web y el MCP. Puro: el conteo lo
 * hace el adaptador dentro de la transacción y acá solo se decide.
 */

/**
 * Ofertas cargadas a mano por persona. Una persona normal carga decenas; mil es holgado y corta
 * a quien automatiza altas desde un cliente MCP hasta llenar la base.
 */
export const MAX_MANUAL_JOBS_PER_PERSON = 1_000;

/**
 * Bytes de `raw_blobs` por persona (emails, avisos y JD pegadas guardados tal cual llegaron).
 * 250 MB alcanzan para miles de avisos y emails de alerta; más que eso es relleno.
 */
export const MAX_RAW_BYTES_PER_PERSON = 250 * 1024 * 1024;

/** Largo máximo de una pregunta y de una respuesta de formulario (igual que las acciones web). */
export const MAX_ANSWER_QUESTION_CHARS = 2_000;
export const MAX_ANSWER_CHARS = 10_000;
/** Largo máximo del texto con que se busca en el banco de respuestas. */
export const MAX_ANSWER_QUERY_CHARS = 500;

export type PersonUsage = { manualJobs: number; rawBytes: number };
export type PersonQuotaAdd = { newManualJobs: number; incomingBytes: number };

export type PersonQuotaCheck = { ok: true } | { ok: false; kind: "manual_jobs" | "raw_bytes" };

export type PersonQuotaLimits = { maxManualJobs: number; maxRawBytes: number };

export const DEFAULT_PERSON_QUOTA_LIMITS: PersonQuotaLimits = {
  maxManualJobs: MAX_MANUAL_JOBS_PER_PERSON,
  maxRawBytes: MAX_RAW_BYTES_PER_PERSON,
};

/** ¿Entra lo nuevo sin pasar los topes? Lo que ya hay no se toca. */
export function checkPersonQuota(
  usage: PersonUsage,
  add: PersonQuotaAdd,
  limits: PersonQuotaLimits = DEFAULT_PERSON_QUOTA_LIMITS,
): PersonQuotaCheck {
  if (add.newManualJobs > 0 && usage.manualJobs + add.newManualJobs > limits.maxManualJobs) {
    return { ok: false, kind: "manual_jobs" };
  }
  if (add.incomingBytes > 0 && usage.rawBytes + add.incomingBytes > limits.maxRawBytes) {
    return { ok: false, kind: "raw_bytes" };
  }
  return { ok: true };
}
