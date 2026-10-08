/**
 * Respuesta de `/api/cron/evaluate` (JS-110). `cron.yml` imprime el cuerpo en el log de Actions,
 * que es público: lleva solo conteos y, si hubo errores, un conteo por categoría de texto cerrado.
 * Nunca `jobId`, mensaje ni texto que venga de la base o del proveedor. El detalle va a pino.
 */

export type CronErrorCategory = "llm" | "validacion" | "otro";

export type CronErrorCounts = Record<CronErrorCategory, number>;

type OutcomeLike = { ok: boolean; jobId?: string; error?: string };

type SummaryLike = { outcomes: readonly OutcomeLike[] } & Record<string, unknown>;

const LLM_KINDS = ["no_route", "prompt", "provider_unavailable", "generation_failed", "aborted"];

// Mensajes fijos de evaluateOne para datos que no se pueden evaluar (sin interpolar nada del usuario).
const VALIDATION_PREFIXES = [
  "job inexistente",
  "job sin jd_text",
  "job en estado ",
  "usuario sin perfil",
];

/** Clasifica el texto de un error en una categoría cerrada; lo desconocido es "otro". */
export function classifyCronError(error: string): CronErrorCategory {
  if (LLM_KINDS.some((k) => error.startsWith(`${k}:`))) return "llm";
  if (VALIDATION_PREFIXES.some((p) => error.startsWith(p))) return "validacion";
  return "otro";
}

/** Una línea de log por error (con ids y mensaje): va a pino, nunca a la respuesta. */
export function failedOutcomes(
  outcomes: readonly OutcomeLike[],
): { jobId: string | null; category: CronErrorCategory; message: string }[] {
  return outcomes
    .filter((o) => !o.ok)
    .map((o) => ({
      jobId: o.jobId ?? null,
      category: classifyCronError(o.error ?? ""),
      message: (o.error ?? "").slice(0, 200),
    }));
}

/**
 * Cuerpo público del cron: los conteos numéricos del resumen (el resto se descarta) y `errors`
 * solo si hubo errores.
 */
export function buildEvaluateCronResponse(summary: SummaryLike): Record<string, unknown> {
  const { outcomes, ...rest } = summary;
  const counts: Record<string, number> = {};
  for (const [k, v] of Object.entries(rest)) {
    if (typeof v === "number" && Number.isFinite(v)) counts[k] = v;
  }
  const errors: CronErrorCounts = { llm: 0, validacion: 0, otro: 0 };
  for (const f of failedOutcomes(outcomes)) errors[f.category] += 1;
  const hasErrors = errors.llm + errors.validacion + errors.otro > 0;
  return { ok: true, ...counts, ...(hasErrors ? { errors } : {}) };
}
