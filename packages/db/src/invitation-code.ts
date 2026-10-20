import { createHash, randomBytes } from "node:crypto";

/**
 * Código de invitación (JS-091), compartido por la app y por los comandos admin:*. Sin base de
 * datos ni variables de entorno. El código en claro va solo en el link y se muestra una vez; en la
 * base queda su sha256.
 */
export const INVITATION_TTL_DAYS = 14;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function hashInvitationCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

/** 32 bytes aleatorios en base64url (43 caracteres): no se adivina ni se enumera. */
export function generateInvitationCode(): { code: string; codeHash: string } {
  const code = randomBytes(32).toString("base64url");
  return { code, codeHash: hashInvitationCode(code) };
}

/**
 * Admins que pueden crear invitaciones (ADMIN_EMAILS, separados por coma). Vacía o sin definir:
 * nadie. Se compara normalizado, nunca con un valor que venga del cliente.
 */
export function isInvitationAdmin(
  email: string | null | undefined,
  adminEmails: string | undefined,
): boolean {
  if (!email || !adminEmails) return false;
  const wanted = normalizeEmail(email);
  return adminEmails
    .split(",")
    .map(normalizeEmail)
    .some((admin) => admin !== "" && admin === wanted);
}
