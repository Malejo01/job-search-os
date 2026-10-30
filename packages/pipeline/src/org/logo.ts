/**
 * Logo de una institución (C-16 §4, ticket B2B-2). Puro: decide por los primeros bytes, nunca por
 * la extensión ni por el Content-Type que mande el navegador. Solo PNG y JPEG de hasta 100 KB.
 * SVG nunca: puede llevar script adentro.
 */
export const ORG_LOGO_MAX_BYTES = 100 * 1024;

export type LogoCheck =
  | { ok: true; contentType: "image/png" | "image/jpeg" }
  | { ok: false; reason: "vacio" | "muy_grande" | "formato" };

const PNG = [0x89, 0x50, 0x4e, 0x47];
const JPEG = [0xff, 0xd8, 0xff];

const startsWith = (bytes: Uint8Array, magic: readonly number[]) =>
  bytes.length >= magic.length && magic.every((b, i) => bytes[i] === b);

export function checkOrgLogo(bytes: Uint8Array): LogoCheck {
  if (bytes.length === 0) return { ok: false, reason: "vacio" };
  if (bytes.length > ORG_LOGO_MAX_BYTES) return { ok: false, reason: "muy_grande" };
  if (startsWith(bytes, PNG)) return { ok: true, contentType: "image/png" };
  if (startsWith(bytes, JPEG)) return { ok: true, contentType: "image/jpeg" };
  return { ok: false, reason: "formato" };
}

/** Color de acento de la institución: solo `#rrggbb`; cualquier otra cosa, null (sin acento). */
export function orgAccentColor(raw: string | null | undefined): string | null {
  const value = raw?.trim().toLowerCase() ?? "";
  return /^#[0-9a-f]{6}$/.test(value) ? value : null;
}
