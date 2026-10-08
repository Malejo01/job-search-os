import { z } from "zod";

/**
 * Términos versionados (JS-106). Parte pura: sin base de datos ni entorno.
 * Subir la versión cuando cambie el texto de `content/legal/{terminos,privacidad}.md`: cada cuenta
 * nueva guarda la versión que aceptó (users.terms_version) junto con la fecha.
 */
export const TERMS_VERSION = "2026-10-07";

/** Casilla de /register: llega como "on" desde un checkbox HTML; cualquier otra cosa es "no aceptó". */
const acceptedSchema = z.literal("on");

export function termsAccepted(value: unknown): boolean {
  return acceptedSchema.safeParse(value).success;
}

/** Valida la casilla en el servidor y devuelve la versión vigente que hay que guardar. */
export function validateTermsAcceptance(
  value: unknown,
): { ok: true; version: string } | { ok: false; reason: "terminos" } {
  return termsAccepted(value)
    ? { ok: true, version: TERMS_VERSION }
    : { ok: false, reason: "terminos" };
}
