/**
 * Encendido del asistente (AG-3). Puro: la app lee el entorno y el email de la sesión y los pasa.
 * Mismo patrón que lo demás que es solo para admin: `ASSISTANT_ENABLED=admin` y el email en
 * `ADMIN_EMAILS`. Apagado por defecto: cualquier otro valor (vacío, "1", "all") es «apagado».
 */

export type AssistantMode = "off" | "admin";

export function assistantMode(env: Record<string, string | undefined>): AssistantMode {
  return env.ASSISTANT_ENABLED?.trim() === "admin" ? "admin" : "off";
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

/** ¿Esta persona puede usar el asistente? Solo admins, y solo con el flag en "admin". */
export function assistantAllowed(
  env: Record<string, string | undefined>,
  email: string | null | undefined,
): boolean {
  return assistantMode(env) === "admin" && isAdminEmail(email, env.ADMIN_EMAILS);
}
