/**
 * Error de la base apto para logs: solo código SQLSTATE, constraint y nombre de la clase.
 * Nunca `message`, `query` ni `params`: en Drizzle/postgres-js traen la consulta con sus
 * parámetros (JD, título, empresa, sueldo). Drizzle envuelve el error original en `cause`.
 */
export type SafeDbError = { code?: string; constraint?: string; name: string };

const asRecord = (v: unknown): Record<string, unknown> | null =>
  typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;

export function safeDbError(err: unknown): SafeDbError {
  const outer = asRecord(err);
  if (!outer) return { name: "UnknownError" };
  // El error de postgres-js (PostgresError) es la causa del DrizzleQueryError
  const inner = asRecord(outer.cause);
  const src = typeof outer.code === "string" || !inner ? outer : inner;
  const out: SafeDbError = { name: typeof src.name === "string" ? src.name : "Error" };
  if (typeof src.code === "string") out.code = src.code;
  const constraint = src.constraint_name ?? src.constraint;
  if (typeof constraint === "string") out.constraint = constraint;
  return out;
}
