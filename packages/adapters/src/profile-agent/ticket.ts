import { createHmac, timingSafeEqual } from "node:crypto";
import {
  PROFILE_AGENT_TICKET_TTL_MS,
  parseProfileTicket,
  profileTicketExpired,
  profileTicketPayload,
  type ProfileAgentTicket,
} from "@job-search-os/pipeline";

/**
 * Firma y verificación del ticket del agente de perfil (ADR-034). El formato y el vencimiento son del
 * pipeline (`profile-agent/ticket.ts`); acá solo el HMAC. Sin `AUTH_SECRET` no se emiten ni se aceptan
 * tickets (falla cerrado). La subclave es distinta de la del chat de CV: un ticket de un flujo no vale
 * en el otro, aunque el id coincida.
 */

function subkey(secret: string): Buffer {
  return createHmac("sha256", secret).update("profileagent-ticket-v1").digest();
}

function mac(secret: string, userId: string, payload: string): string {
  return createHmac("sha256", subkey(secret))
    .update(`profileagent|${userId}|${payload}`)
    .digest("base64url");
}

export function signProfileAgentTicket(
  secret: string | undefined,
  userId: string,
  ticket: ProfileAgentTicket,
  now: number,
): string | null {
  if (!secret || !userId) return null;
  const payload = profileTicketPayload(ticket.flowId, now + PROFILE_AGENT_TICKET_TTL_MS);
  return `${payload}.${mac(secret, userId, payload)}`;
}

export function verifyProfileAgentTicket(
  secret: string | undefined,
  userId: string,
  raw: unknown,
  now: number,
): ProfileAgentTicket | null {
  if (!secret || !userId) return null;
  const parsed = parseProfileTicket(raw);
  if (!parsed) return null;
  const expected = Buffer.from(mac(secret, userId, parsed.payload));
  const actual = Buffer.from(parsed.mac);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  if (profileTicketExpired(parsed, now)) return null;
  return { flowId: parsed.flowId };
}
