import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Ticket firmado del chat de CV (C-25). La conversación no se guarda: el estado viaja en el request. Lo
 * que el servidor no puede dejar en manos del navegador son el id de la charla (con él se mide el gasto
 * por conversación) y la cantidad de turnos (tope de 25): van en este ticket, atados al usuario con HMAC.
 * Sin `AUTH_SECRET` no se emiten ni se aceptan tickets (falla cerrado).
 */
export const CV_TICKET_TTL_MS = 2 * 60 * 60 * 1000;

export type CvTicket = { conversationId: string; turns: number };

function mac(secret: string, userId: string, payload: string): string {
  return createHmac("sha256", secret).update(`cvchat|${userId}|${payload}`).digest("base64url");
}

export function signCvTicket(
  secret: string | undefined,
  userId: string,
  ticket: CvTicket,
  now: number,
): string | null {
  if (!secret) return null;
  const payload = `${ticket.conversationId}.${ticket.turns}.${now + CV_TICKET_TTL_MS}`;
  return `${payload}.${mac(secret, userId, payload)}`;
}

export function verifyCvTicket(
  secret: string | undefined,
  userId: string,
  raw: unknown,
  now: number,
): CvTicket | null {
  if (!secret || typeof raw !== "string" || raw.length > 200) return null;
  const parts = raw.split(".");
  if (parts.length !== 4) return null;
  const [conversationId, turnsRaw, expRaw, given] = parts as [string, string, string, string];
  if (!/^[0-9a-f]{12}$/.test(conversationId)) return null;
  if (!/^\d{1,3}$/.test(turnsRaw) || !/^\d{10,15}$/.test(expRaw)) return null;
  const expected = Buffer.from(mac(secret, userId, `${conversationId}.${turnsRaw}.${expRaw}`));
  const actual = Buffer.from(given);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  if (Number(expRaw) < now) return null;
  return { conversationId, turns: Number(turnsRaw) };
}

/** `Origin` de un POST: tiene que ser el del propio sitio. Sin cabecera, no. */
export function originAllowed(origin: string | null, allowed: readonly string[]): boolean {
  if (!origin) return false;
  try {
    return allowed.includes(new URL(origin).origin);
  } catch {
    return false;
  }
}
