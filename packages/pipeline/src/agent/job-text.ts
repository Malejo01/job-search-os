/**
 * Descripción de una oferta para el asistente (AG-3): antes de que vaya al modelo se reemplazan
 * emails, teléfonos y links por marcadores. El modelo no los necesita para explicar una oferta y
 * así no viajan datos de contacto de terceros (reclutadores) a un proveedor. Puro y acotado: se
 * trabaja sobre un prefijo del texto y con cuantificadores con tope (sin ReDoS).
 */

/** Cuánto texto se mira antes de redactar (el resultado se recorta después a `maxChars`). */
const SCAN_CHARS = 12_000;

const EMAIL = /[a-z0-9._%+-]{1,64}@[a-z0-9-]{1,63}(?:\.[a-z0-9-]{1,63}){0,8}\.[a-z]{2,24}/gi;
const URL =
  /\b(?:https?:\/\/|www\.)[^\s<>"')\]]{1,500}|\b(?:[a-z0-9-]{1,63}\.){1,8}(?:com|net|org|io|dev|app|ar|co|me|ai|info|edu|gov|br|cl|uy|mx|es|us|uk|tech|xyz)\/[^\s<>"')\]]{0,500}/gi;
const PHONE_INTL = /\+\d[\d\s().-]{7,18}\d/g;
const PHONE_LOCAL = /\b\(?\d{2,4}\)?[\s.-]\d{3,4}[\s.-]\d{4}\b|\b\d{4}[\s.-]\d{4}\b/g;

const digitsOf = (s: string): string => s.replace(/\D/g, "");
const YEAR = /^(?:19|20)\d{2}$/;
/** «2019 - 2023» o «2020-2024» son años, no un teléfono. */
const onlyYears = (s: string): boolean => {
  const parts = s.split(/[\s.()-]+/).filter(Boolean);
  return parts.length > 0 && parts.every((p) => YEAR.test(p));
};

export function redactJobContacts(text: string, maxChars: number): string {
  const out = text
    .slice(0, SCAN_CHARS)
    .replace(EMAIL, "[email]")
    .replace(URL, "[link]")
    .replace(PHONE_INTL, (m) => (digitsOf(m).length >= 9 ? "[tel]" : m))
    .replace(PHONE_LOCAL, (m) => (!onlyYears(m) && digitsOf(m).length >= 8 ? "[tel]" : m));
  return out.slice(0, maxChars);
}
