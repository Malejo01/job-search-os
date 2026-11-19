import pino, { type Logger, type LoggerOptions } from "pino";
import { safeDbError } from "./logging/safe-error";

/** Campos que nunca llegan al log, en el primer nivel o dentro de un objeto. */
const SENSITIVE_KEYS = ["authorization", "cookie", "password", "token", "email", "params", "query"];

/** Un error se reduce a nombre, código y constraint; un motivo en texto queda como está. */
function safeErrorValue(value: unknown): unknown {
  return typeof value === "object" && value !== null ? safeDbError(value) : value;
}

export function loggerOptions(bindings: Record<string, unknown> = {}): LoggerOptions {
  return {
    level: process.env.LOG_LEVEL ?? "info",
    base: bindings,
    redact: {
      paths: SENSITIVE_KEYS.flatMap((key) => [key, `*.${key}`]),
      censor: "[oculto]",
    },
    serializers: { err: safeErrorValue, error: safeErrorValue },
  };
}

/**
 * Logger estructurado (CLAUDE.md: siempre user_id y job_id/run_id cuando existan).
 * Nivel por LOG_LEVEL; `silent` en tests.
 */
export function createLogger(bindings: Record<string, unknown> = {}): Logger {
  return pino(loggerOptions(bindings));
}

export type { Logger };
