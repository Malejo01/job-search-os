import { baseDomain, isWebmailDomain } from "@job-search-os/pipeline";

/**
 * Parte pura de filter-leak.ts (sin base de datos), para poder probarla desde packages/db
 * (apps/web no tiene runner propio).
 */

/** Dominio base válido (lo que llega del formulario); null si no parece un dominio. */
export function cleanDomain(raw: string): string | null {
  const d = baseDomain(raw);
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d) ? d : null;
}

export type SetSenderVerdictResult = { ok: true } | { ok: false; error: "webmail" };

/** Mensaje para la persona cuando se rechaza "empleo" sobre un proveedor de correo personal (RM-3). */
export function webmailRejectionMessage(domain: string): string {
  return `No se puede marcar ${domain} como fuente de empleo: es un proveedor de correo personal, y se guardarían completos los mails de cualquier persona con esa cuenta. Para alertas reenviadas a mano, configurá un filtro de reenvío automático.`;
}

/** Destinos válidos para volver tras un rechazo (el formulario manda `back`; nunca una URL libre). */
export function safeBackPath(raw: unknown): string {
  const v = String(raw ?? "");
  return /^\/(inbox|inbox\/[0-9a-f-]{36}|settings\/senders)$/.test(v) ? v : "/inbox";
}

/** URL de vuelta con el error de webmail (`?error=webmail&sender=<dominio>`). */
export function webmailErrorUrl(back: string, domain: string): string {
  return `${back}?error=webmail&sender=${encodeURIComponent(domain)}`;
}

/**
 * Lee `?error=webmail&sender=` de los searchParams; devuelve el mensaje o null. Un searchParam
 * repetido llega como array: no es un string y se ignora.
 */
export function webmailErrorFromParams(params: {
  error?: string | string[];
  sender?: string | string[];
}): string | null {
  const { error, sender } = params;
  if (typeof error !== "string" || typeof sender !== "string") return null;
  if (error !== "webmail" || !sender) return null;
  const domain = cleanDomain(sender);
  return domain && isWebmailDomain(domain) ? webmailRejectionMessage(domain) : null;
}
