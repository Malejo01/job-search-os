import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";

/**
 * Parte pura de las invitaciones (JS-091): sin base de datos ni variables de entorno.
 * El código en claro va solo en el link y se muestra una vez; en la base queda su sha256.
 */
export const INVITATION_TTL_DAYS = 14;
export const MIN_PASSWORD_LENGTH = 8;
export const INVALID_INVITATION_MESSAGE = "invitación inválida o vencida";

/** Tope por scrypt en una ruta pública: sin él, una contraseña enorme es CPU gratis para quien ataca. */
export const MAX_PASSWORD_LENGTH = 128;

const emailSchema = z.email().max(254);

export function hashInvitationCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

/** 32 bytes aleatorios en base64url (43 caracteres): no se adivina ni se enumera. */
export function generateInvitationCode(): { code: string; codeHash: string } {
  const code = randomBytes(32).toString("base64url");
  return { code, codeHash: hashInvitationCode(code) };
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return emailSchema.safeParse(normalizeEmail(email)).success;
}

export type RegistrationInput = { code: string; email: string; password: string; name?: string };

export const MAX_CODE_LENGTH = 64;
export const MAX_NAME_LENGTH = 100;

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

/** Mismas reglas que /setup y el reset (8+), con topes de largo en servidor (scrypt en ruta pública). */
export function validateRegistration(
  input: RegistrationInput,
): { ok: true } | { ok: false; reason: "code" | "email" | "password" | "name" } {
  if (!input.code || input.code.length > MAX_CODE_LENGTH) return { ok: false, reason: "code" };
  if (!isValidEmail(input.email)) return { ok: false, reason: "email" };
  if ((input.name ?? "").trim().length > MAX_NAME_LENGTH) return { ok: false, reason: "name" };
  if (input.password.length < MIN_PASSWORD_LENGTH || input.password.length > MAX_PASSWORD_LENGTH) {
    return { ok: false, reason: "password" };
  }
  return { ok: true };
}

export type InvitationStatus = "pendiente" | "usada" | "vencida";

export function invitationStatus(
  row: { usedAt: Date | null; expiresAt: Date },
  now: Date,
): InvitationStatus {
  if (row.usedAt) return "usada";
  return row.expiresAt.getTime() <= now.getTime() ? "vencida" : "pendiente";
}
