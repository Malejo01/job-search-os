import { z } from "zod";

/**
 * Contacto de la vitrina (ronda 72). El email no vive en el repo (es público): lo carga Mauro en
 * `CONTACT_EMAIL`. Acá solo la parte pura: validar el valor y armar el `mailto:`.
 */
const contactSchema = z.string().trim().max(254).email();

/** Devuelve el email recortado si tiene formato válido; `null` si falta, está vacío o es inválido. */
export function parseContactEmail(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const parsed = contactSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** `mailto:` con el asunto codificado (acentos y espacios incluidos). */
export function buildMailto(email: string, subject: string): string {
  return `mailto:${email}?subject=${encodeURIComponent(subject)}`;
}
