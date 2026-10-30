/**
 * Verificación de links del catálogo de aprendizaje (diseño §2). Pura: no abre ninguna URL, solo
 * clasifica lo que otro observó. Falla cerrado: lo que no se entiende es `error`, nunca `ok`.
 */
import { parseManualUrl } from "../manual-url";

export type LinkStatus = "ok" | "moved" | "gone" | "blocked" | "error" | "skipped";

export type LinkStep =
  { status: number } | { failure: "timeout" | "network" | "unsafe_url" | "too_many_redirects" };

export const MAX_REDIRECT_HOPS = 3;
export const LINK_FAILURE_GAP_DAYS = 7;
export const LINK_BROKEN_AFTER = 2;

const DAY_MS = 86_400_000;

function isRedirect(s: number): boolean {
  return s >= 300 && s < 400;
}

/**
 * `steps` es la secuencia observada: los 3xx seguidos y, al final, la respuesta definitiva.
 * `finalIsOtherRoute`: el destino final tiene otro host o ruta que la URL guardada.
 */
export function classifyLinkCheck(
  steps: readonly LinkStep[],
  finalIsOtherRoute: boolean,
): LinkStatus {
  if (steps.length === 0) return "error";
  const statuses: number[] = [];
  for (const step of steps) {
    if (!("status" in step)) return "error"; // cualquier falla de transporte
    if (!Number.isInteger(step.status)) return "error";
    statuses.push(step.status);
  }
  const last = statuses[statuses.length - 1] as number;
  const hops = statuses.slice(0, -1);
  if (hops.length > MAX_REDIRECT_HOPS) return "error";
  if (!hops.every(isRedirect)) return "error"; // una respuesta final en el medio no se entiende

  if (last >= 200 && last < 300) {
    return hops.length > 0 && finalIsOtherRoute ? "moved" : "ok";
  }
  if (last === 404 || last === 410) return "gone";
  if (last === 401 || last === 403 || last === 429) return "blocked";
  return "error"; // 5xx, un 3xx sin destino y todo lo no previsto
}

export type LinkHealth = { consecutiveFailures: number; lastFailureAt: string | null };

/**
 * Salud acumulada del link. Solo `gone` o `error` suman, y como mucho una vez cada 7 días: dos
 * corridas semanales seguidas. `blocked` y `skipped` no dicen nada, así que no tocan.
 */
export function nextLinkHealth(
  prev: LinkHealth,
  status: LinkStatus,
  now: string,
): LinkHealth & { broken: boolean } {
  let next: LinkHealth = { ...prev };
  if (status === "ok" || status === "moved") {
    next = { consecutiveFailures: 0, lastFailureAt: null };
  } else if (status === "gone" || status === "error") {
    const last = prev.lastFailureAt === null ? Number.NaN : Date.parse(prev.lastFailureAt);
    const nowMs = Date.parse(now);
    // Con un `now` ilegible no se suma ni se guarda: un error del llamador no rompe un link
    const enoughTime =
      !Number.isNaN(nowMs) &&
      (Number.isNaN(last) || nowMs - last >= LINK_FAILURE_GAP_DAYS * DAY_MS);
    if (enoughTime)
      next = { consecutiveFailures: prev.consecutiveFailures + 1, lastFailureAt: now };
  }
  return { ...next, broken: next.consecutiveFailures >= LINK_BROKEN_AFTER };
}

/**
 * Solo http(s) público, sin credenciales ni hosts internos o IPs en formas raras. Reusa la
 * validación del alta manual (`parseManualUrl`), que ya cubre los rangos privados IPv4/IPv6.
 * No alcanza contra un dominio público que resuelva a una IP interna (ver manual-url.ts).
 */
export function isCheckableUrl(url: string): boolean {
  const parsed = parseManualUrl(url);
  return parsed.ok && parsed.url !== null;
}

function siteOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * Mismo sitio: el mismo host, con o sin `www.`. El verificador solo sigue redirecciones dentro del
 * sitio. Un salto a otro dominio no se pide (es la vía realista de SSRF por redirección abierta o
 * dominio retomado): queda para que lo revise una persona.
 */
export function sameSite(a: string, b: string): boolean {
  const sa = siteOf(a);
  return sa !== null && sa === siteOf(b);
}
