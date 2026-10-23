/**
 * Versión de sesión (S-6). Puro: decide si un JWT sigue valiendo comparando la versión que trae con
 * la de la base. Un JWT emitido antes de este cambio no trae versión y cuenta como 0, que es el valor
 * inicial de la columna: así nadie queda afuera al desplegar.
 */
export type SessionCheck = "ok" | "sin_usuario" | "vencida";

export function sessionVersionCheck(tokenVersion: unknown, dbVersion: number | null): SessionCheck {
  if (dbVersion === null) return "sin_usuario";
  const valid = typeof tokenVersion === "number" && Number.isInteger(tokenVersion);
  const token = valid ? tokenVersion : 0;
  return token === dbVersion ? "ok" : "vencida";
}
