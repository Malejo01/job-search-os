export type SourceErrorCode =
  "timeout" | "http_429" | "http_4xx" | "http_5xx" | "parse" | "unknown";

/** Código de error de lista cerrada: nunca el mensaje crudo (la respuesta del cron es pública). */
export function sourceErrorCode(e: unknown, timedOut = false): SourceErrorCode {
  if (timedOut) return "timeout";
  const message = e instanceof Error ? e.message : "";
  if (message === "timeout" || message === "timeout de la fuente") return "timeout";
  if (e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError"))
    return "timeout";
  const http = /\bHTTP (\d{3})\b/.exec(message);
  if (http) {
    const code = Number(http[1]);
    if (code === 429) return "http_429";
    if (code >= 500) return "http_5xx";
    if (code >= 400) return "http_4xx";
  }
  if (e instanceof SyntaxError || /respuesta inesperada|no es un array/.test(message))
    return "parse";
  return "unknown";
}

/**
 * Categoría cerrada de un fallo, para mensajes de consola. Nunca el mensaje original: un
 * SyntaxError de JSON puede traer un fragmento del cuerpo de la respuesta.
 */
export function describeFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  const http = /\bHTTP (\d{3})\b/.exec(message);
  if (http) return `HTTP ${http[1]}`;
  const code = sourceErrorCode(error);
  if (code === "timeout") return "timeout";
  if (code === "parse") return "respuesta no es JSON";
  if (error instanceof TypeError) return "error de red";
  return "error desconocido";
}
