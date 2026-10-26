import { APICallError, NoObjectGeneratedError, RetryError } from "ai";

/**
 * Código cerrado de un error del LLM (D-027, JS-123). Es lo único que se guarda en
 * `llm_calls.error` y lo que viaja en `LlmError.detail`: nunca `e.message`, que en los errores de
 * proveedor puede citar el prompt (el JD) o la salida del modelo.
 *
 * Formato: `api_call[:<status>]`, `no_object`, `refusal`, `validation[:<code>,…]`, `timeout`, `aborted`,
 * `no_route`, `provider_unavailable`, `unknown`.
 */
export const LLM_ERROR_CODE_PATTERN =
  "^(api_call(:[1-5][0-9]{2})?|no_object|refusal|validation(:[a-z_]+(,[a-z_]+){0,2})?|timeout|aborted|no_route|provider_unavailable|unknown)$";

const CODE_RE = new RegExp(LLM_ERROR_CODE_PATTERN);

export const isLlmErrorCode = (s: string): boolean => s.length <= 120 && CODE_RE.test(s);

/** La salida no cumplió el schema. Solo lleva los `code` de zod (enum cerrado), sin paths ni valores. */
export class LlmValidationError extends Error {
  readonly issueCodes: readonly string[];
  constructor(issues: readonly { code: string }[]) {
    super("salida no cumple el schema");
    this.name = "LlmValidationError";
    this.issueCodes = [...new Set(issues.map((i) => i.code))].slice(0, 3);
  }
}

/**
 * Sufijo FIJO que se agrega al código en `LlmError.detail` (nunca en `llm_calls.error`) para que
 * `classifyError` de evals/src/run.ts siga clasificando por texto: sin él, todo caería en `retry`.
 * Son constantes nuestras, ningún texto del proveedor. 429 es `PerMinute` (espera con tope de 3
 * reintentos en run.ts), no fatal.
 */
export function llmErrorDetail(code: string): string {
  if (code.startsWith("validation")) return `${code} salida no cumple el schema`;
  if (code === "api_call:401" || code === "api_call:403") return `${code} PERMISSION_DENIED`;
  if (code === "api_call:402") return `${code} credits are depleted`;
  if (code === "api_call:429") return `${code} PerMinute`;
  return code;
}

const validStatus = (n: unknown): n is number =>
  typeof n === "number" && Number.isInteger(n) && n >= 100 && n <= 599;

/**
 * Normaliza un error a un código cerrado leyendo solo propiedades estructuradas (`name`,
 * `statusCode`, `issueCodes`), nunca `message`. Función pura.
 */
export function normalizeLlmError(e: unknown): string {
  if (e instanceof LlmValidationError) {
    const codes = e.issueCodes.filter((c) => /^[a-z_]+$/.test(c));
    return codes.length > 0 ? `validation:${codes.join(",")}` : "validation";
  }
  if (NoObjectGeneratedError.isInstance(e)) {
    // `stop_reason: "refusal"` de Anthropic llega como finishReason `content-filter`; los filtros
    // de seguridad de Gemini también, así que `refusal` puede venir de cualquiera de los dos
    return e.finishReason === "content-filter" ? "refusal" : "no_object";
  }
  // generateObject envuelve el último error del proveedor en un RetryError tras los reintentos
  if (RetryError.isInstance(e)) return normalizeLlmError(e.lastError);
  if (e === null || typeof e !== "object") return "unknown";
  const { name } = e as { name?: unknown };
  if (name === "TimeoutError") return "timeout";
  if (name === "AbortError") return "aborted";
  if (name === "AI_TypeValidationError" || name === "ZodError") return "validation";
  const status = (e as { statusCode?: unknown }).statusCode;
  if (APICallError.isInstance(e) || name === "AI_APICallError") {
    if (isCreditsDepleted(e, status)) return "api_call:402";
    return validStatus(status) ? `api_call:${status}` : "api_call";
  }
  return "unknown";
}

/**
 * Crédito agotado de Anthropic: llega como 400 `invalid_request_error` con «credit balance is too
 * low» o como 402 `billing_error`. Se clasifica por el `type` estructurado del cuerpo y, si el SDK
 * no lo parseó, por esa frase acotada. El texto solo se compara: no se guarda ni se devuelve.
 * Un 402 real entra por la rama normal (`api_call:402`) y no necesita este camino.
 */
function isCreditsDepleted(e: object, status: unknown): boolean {
  if (status !== 400) return false;
  const { data, responseBody } = e as { data?: unknown; responseBody?: unknown };
  const type = (data as { error?: { type?: unknown } } | undefined)?.error?.type;
  if (type === "billing_error") return true;
  return typeof responseBody === "string" && /credit balance is too low/i.test(responseBody);
}
