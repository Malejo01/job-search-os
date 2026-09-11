import pino, { type Logger } from "pino";

/**
 * Logger estructurado (CLAUDE.md: siempre user_id y job_id/run_id cuando existan).
 * Nivel por LOG_LEVEL; `silent` en tests.
 */
export function createLogger(bindings: Record<string, unknown> = {}): Logger {
  return pino({ level: process.env.LOG_LEVEL ?? "info", base: bindings });
}

export type { Logger };
