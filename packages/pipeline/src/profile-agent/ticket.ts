/**
 * Ticket del agente de perfil (ADR-034): la parte pura. La charla no se guarda; lo único que el servidor
 * no puede dejar en manos del navegador es el id de la charla (`flowId`), porque con él se miden el gasto y
 * los turnos por charla en `llm_calls` (`label = cv:<flowId>`). Un navegador que inventara ids podría
 * reiniciar esos topes en cada request. El ticket ata ese id a la persona y lo vence.
 *
 * Los contadores NO viajan en el ticket: los turnos, el gasto y si ya se redactó salen de `llm_calls` por
 * `label`. Un ticket viejo reenviado no devuelve turnos. El HMAC lo firma y verifica
 * `packages/adapters/src/profile-agent/ticket.ts`; acá solo el formato, para poder probarlo sin `node:crypto`.
 *
 * Formato: `pa1.<flowId>.<vence en ms>.<mac>`. El prefijo `pa1` evita confundirlo con el ticket del chat
 * de CV (`<id>.<turnos>.<vence>.<mac>`), que además se firma con otra subclave.
 */

export const PROFILE_AGENT_TICKET_TTL_MS = 2 * 60 * 60 * 1000;
export const PROFILE_AGENT_TICKET_PREFIX = "pa1";
export const PROFILE_AGENT_TICKET_MAX_CHARS = 200;

export type ProfileAgentTicket = { flowId: string };

export const isProfileAgentFlowId = (v: unknown): v is string =>
  typeof v === "string" && /^[0-9a-f]{12}$/.test(v);

/** Lo que firma el HMAC: `pa1.<flowId>.<vence>`. */
export function profileTicketPayload(flowId: string, expiresAtMs: number): string {
  return `${PROFILE_AGENT_TICKET_PREFIX}.${flowId}.${expiresAtMs}`;
}

export type ParsedProfileTicket = {
  flowId: string;
  expiresAtMs: number;
  payload: string;
  mac: string;
};

/** Parte el ticket crudo en sus campos, sin verificar la firma. `null` si no tiene la forma. */
export function parseProfileTicket(raw: unknown): ParsedProfileTicket | null {
  if (typeof raw !== "string" || raw.length > PROFILE_AGENT_TICKET_MAX_CHARS) return null;
  const parts = raw.split(".");
  if (parts.length !== 4) return null;
  const [prefix, flowId, expRaw, mac] = parts as [string, string, string, string];
  if (prefix !== PROFILE_AGENT_TICKET_PREFIX || !isProfileAgentFlowId(flowId)) return null;
  if (!/^\d{10,15}$/.test(expRaw) || !/^[A-Za-z0-9_-]{20,64}$/.test(mac)) return null;
  const expiresAtMs = Number(expRaw);
  return { flowId, expiresAtMs, payload: profileTicketPayload(flowId, expiresAtMs), mac };
}

/** ¿Venció? `now` inyectado, en ms. */
export function profileTicketExpired(parsed: { expiresAtMs: number }, now: number): boolean {
  return !(parsed.expiresAtMs >= now);
}
