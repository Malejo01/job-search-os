/**
 * Encendido del asistente (AG-3). Puro: la app lee el entorno y el email de la sesión y los pasa.
 * `ASSISTANT_ENABLED=admin`: solo los emails de `ADMIN_EMAILS`. `ASSISTANT_ENABLED=testers` (R4-15):
 * `ADMIN_EMAILS` más `ASSISTANT_TESTER_EMAILS`, sin dar permisos de admin. Apagado por defecto:
 * cualquier otro valor (vacío, "1", "all", "Testers") es «apagado».
 */

export type AssistantMode = "off" | "admin" | "testers";

export function assistantMode(env: Record<string, string | undefined>): AssistantMode {
  const v = env.ASSISTANT_ENABLED?.trim();
  return v === "admin" || v === "testers" ? v : "off";
}

const normalizeEmail = (email: string): string => email.trim().toLowerCase();

/** ¿El email está en la lista separada por comas? Mismo criterio que `isInvitationAdmin`. */
export function isAdminEmail(
  email: string | null | undefined,
  adminEmails: string | undefined,
): boolean {
  if (!email || !adminEmails) return false;
  const wanted = normalizeEmail(email);
  if (wanted === "") return false;
  return adminEmails
    .split(",")
    .map(normalizeEmail)
    .some((admin) => admin !== "" && admin === wanted);
}

/**
 * ¿Esta persona puede usar el asistente? Con "admin", solo `ADMIN_EMAILS`; con "testers", también
 * `ASSISTANT_TESTER_EMAILS`. Ser tester no da permisos de admin: la lista solo vale acá.
 */
export function assistantAllowed(
  env: Record<string, string | undefined>,
  email: string | null | undefined,
): boolean {
  const mode = assistantMode(env);
  if (mode === "off") return false;
  if (isAdminEmail(email, env.ADMIN_EMAILS)) return true;
  return mode === "testers" && isAdminEmail(email, env.ASSISTANT_TESTER_EMAILS);
}
