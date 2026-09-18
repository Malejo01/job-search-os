import { err, ok, type Result } from "../result";

export type UrlError = "invalid_url";

/** Parámetros de tracking que no identifican la oferta (comparación sin mayúsculas). */
const TRACKING_PARAMS = new Set(
  [
    "fbclid",
    "gclid",
    "dclid",
    "msclkid",
    "mc_cid",
    "mc_eid",
    "_hsenc",
    "_hsmi",
    "hsctatracking",
    "ref",
    "refid",
    "trk",
    "trkinfo",
    "trackingid",
    "lipi",
    "licu",
    "li_fat_id",
    "refresh",
    "position",
    "pagenum",
    "origin",
    "originalsubdomain",
    "midtoken",
    "midsig",
    "otptoken",
    "ebp",
    "source",
    "src",
  ].map((p) => p.toLowerCase()),
);

const isTracking = (key: string) => {
  const k = key.toLowerCase();
  return k.startsWith("utm_") || TRACKING_PARAMS.has(k);
};

/**
 * URL canónica de una oferta: sin tracking, sin fragmento, sin `www.`, sin barra final,
 * query ordenada. Reglas por fuente: LinkedIn → `/jobs/view/{id}`; Indeed → solo `jk`.
 */
export function canonicalUrl(raw: string): Result<string, UrlError> {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return err("invalid_url");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return err("invalid_url");

  const host = url.hostname.toLowerCase().replace(/^www\./, "");

  const linkedin = canonicalLinkedIn(host, url);
  if (linkedin) return ok(linkedin);

  let params = [...url.searchParams.entries()].filter(([k]) => !isTracking(k));
  if (host.endsWith("indeed.com")) params = params.filter(([k]) => k === "jk");
  params.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  const path = url.pathname.replace(/\/+$/, "");
  const query = params.length ? "?" + new URLSearchParams(params).toString() : "";
  return ok(`${url.protocol}//${host}${path}${query}`);
}

/**
 * LinkedIn: `currentJobId=N`, `/jobs/view/N`, `/comm/jobs/view/N` o `/jobs/view/slug-N` → `/jobs/view/N`.
 * Forma canónica INTENCIONAL: `https://linkedin.com/jobs/view/<id>`, sin `www`, sin subdominio de
 * país y sin barra final. El dedup compara esta cadena exacta (clave fuerte por URL) contra lo ya
 * guardado en `jobs.canonical_url`: cambiarla haría que los avisos nuevos no crucen con los viejos.
 * No es algo a "corregir" (ADR-013).
 */
function canonicalLinkedIn(host: string, url: URL): string | null {
  if (host !== "linkedin.com" && !host.endsWith(".linkedin.com")) return null;

  const fromQuery = url.searchParams.get("currentJobId");
  if (fromQuery && /^\d+$/.test(fromQuery)) return `https://linkedin.com/jobs/view/${fromQuery}`;

  const match = /\/jobs\/view\/(?:[^/?#]*?-)?(\d+)\/?(?:[?#]|$)/.exec(url.pathname + url.search);
  if (match) return `https://linkedin.com/jobs/view/${match[1]}`;

  return null;
}
