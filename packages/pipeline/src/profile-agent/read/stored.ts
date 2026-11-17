/**
 * Lo que la pestaña guarda de una lectura para que recargar la página no obligue a leer el CV de nuevo (R11-1).
 *
 * Por qué existe: cada lectura exitosa descuenta una del cupo mensual (marcador `profile_read`). Si la persona
 * recargaba antes de guardar las tarjetas, la propuesta se perdía y volver a leer gastaba otra lectura. Se
 * guarda la propuesta en `sessionStorage` (por pestaña, se borra al cerrarla, nunca `localStorage`), atada al
 * ticket de la charla: con otro ticket no se usa.
 *
 * Qué NO es: no es el texto del CV (nunca sale del campo de texto) ni la charla. Es la misma propuesta que el
 * servidor ya le mostró a la persona: tarjetas ya revisadas con `screenProfileCards`, sin viñetas, sin
 * sensibles. No hay que firmarla: al guardar, el servidor vuelve a validar y filtrar cada tarjeta que vuelve
 * del navegador (entrada no confiable, ADR-034 §3), así que alterarla acá no abre nada. Puro.
 */
import { z } from "zod";
import { profileReadProposalSchema, type ProfileReadProposal } from "../schemas";
import { parseProfileTicket } from "../ticket";

export const storedReadSummarySchema = z.strictObject({
  experience: z.number().int().min(0).max(999),
  education: z.number().int().min(0).max(999),
  skills: z.number().int().min(0).max(999),
  languages: z.number().int().min(0).max(999),
  dropped: z.number().int().min(0).max(999),
  suggestedRoles: z.array(z.string().max(40)).max(4),
});

export const storedProfileReadSchema = z.strictObject({
  /** Ticket de la charla que nació con esta lectura: con otro, lo guardado no se usa. */
  ticket: z.string().max(300),
  summary: storedReadSummarySchema,
  proposal: profileReadProposalSchema,
  /** La persona ya resolvió alguna tarjeta: si no queda ninguna, no es que la lectura no encontró nada. */
  settled: z.boolean().optional(),
});
export type StoredProfileRead = z.infer<typeof storedProfileReadSchema>;

/**
 * ¿Son de la misma charla? Las etapas siguientes reemiten el ticket (otro vencimiento y otra firma) con el
 * mismo `flowId`, así que se compara el `flowId`; si alguno no tiene la forma de un ticket, solo vale el texto igual.
 */
function sameFlow(a: string, b: string): boolean {
  if (a === b) return true;
  const pa = parseProfileTicket(a);
  const pb = parseProfileTicket(b);
  return pa !== null && pb !== null && pa.flowId === pb.flowId;
}

/** Devuelve lo guardado si es válido y es de la charla del `ticket` actual; si no, `null` (se vuelve a la lectura). */
export function parseStoredRead(
  raw: string | null,
  ticket: string | null,
): StoredProfileRead | null {
  if (!raw || !ticket) return null;
  try {
    const parsed = storedProfileReadSchema.safeParse(JSON.parse(raw));
    return parsed.success && sameFlow(parsed.data.ticket, ticket) ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Saca las tarjetas ya resueltas (guardadas o descartadas): al recargar solo vuelven las pendientes. */
export function pruneStoredRead(
  stored: StoredProfileRead,
  resolvedIds: readonly string[],
): StoredProfileRead {
  const done = new Set(resolvedIds);
  return {
    ...stored,
    settled: stored.settled === true || resolvedIds.length > 0,
    proposal: {
      ...stored.proposal,
      cards: stored.proposal.cards.filter((c) => !done.has(c.id)),
    } satisfies ProfileReadProposal,
  };
}

/**
 * Puestos que sugirió la lectura, para que la guía los ofrezca primero. Un valor roto o desconocido da
 * `[]`: el servidor igual los filtra contra las carreras conocidas.
 */
export function storedSuggestedRoles(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = storedProfileReadSchema.safeParse(JSON.parse(raw));
    return parsed.success ? [...parsed.data.proposal.suggestedRoles] : [];
  } catch {
    return [];
  }
}
