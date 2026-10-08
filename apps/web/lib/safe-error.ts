// Réplica mínima de packages/adapters/src/logging/safe-error.ts (el paquete solo exporta desde
// index.ts, que está en otro PR). Nunca message, query ni params: traen el contenido del aviso.
export type SafeDbError = { code?: string; constraint?: string; name: string };

const asRecord = (v: unknown): Record<string, unknown> | null =>
  typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;

export function safeDbError(err: unknown): SafeDbError {
  const outer = asRecord(err);
  if (!outer) return { name: "UnknownError" };
  const inner = asRecord(outer.cause);
  const src = typeof outer.code === "string" || !inner ? outer : inner;
  const out: SafeDbError = { name: typeof src.name === "string" ? src.name : "Error" };
  if (typeof src.code === "string") out.code = src.code;
  const constraint = src.constraint_name ?? src.constraint;
  if (typeof constraint === "string") out.constraint = constraint;
  return out;
}
