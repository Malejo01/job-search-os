import { z } from "zod";
import { err, ok, type Result } from "../result";
import { CV_OMITTED_MARKER, looksLikeCv } from "./cv-detect";
import { AGENT_LIMITS } from "./limits";
import { PROPOSAL_DESTINATIONS, type ProposalDestination } from "./types";

/**
 * Historial del asistente. Las conversaciones no se guardan: el cliente manda el historial en cada
 * turno y acá se valida (es la frontera) y se resume sin LLM para que entre en el tope de entrada.
 *
 * Orden en la ruta (AG-3): `screenUserMessage` sobre el mensaje nuevo (un CV se deriva antes del
 * tope de largo) → `sanitizeHistory` (un CV de un turno anterior pasa a marcador, así no lo
 * rechaza el tope) → `validateHistory` (tope de 2.000 por mensaje de la persona) →
 * `summarizeHistory` y `groundingSourcesFrom`. El resumen va al modelo como un bloque de DATOS
 * delimitado, nunca en el system prompt, y nunca entra a las fuentes de fundamento.
 */

export type AgentMessage = { role: "user" | "assistant"; text: string };

export type ProposalOutcome = {
  destination: ProposalDestination;
  fields: string[];
  status: "pendiente" | "cargada" | "descartada";
};

/**
 * 10 turnos de ida y vuelta (20 mensajes) más el mensaje del turno 11: ese llega para que la ruta
 * conteste con el aviso fijo de tope (con links) y no con un error de historial.
 */
export const MAX_HISTORY_MESSAGES = AGENT_LIMITS.maxTurnsPerConversation * 2 + 1;
export const MAX_ASSISTANT_MESSAGE_CHARS = 4_000;

const messageSchema = z.discriminatedUnion("role", [
  z
    .object({
      role: z.literal("user"),
      text: z.string().trim().min(1).max(AGENT_LIMITS.maxUserMessageChars),
    })
    .strict(),
  z
    .object({
      role: z.literal("assistant"),
      text: z.string().trim().min(1).max(MAX_ASSISTANT_MESSAGE_CHARS),
    })
    .strict(),
]);

/**
 * Valida el historial que manda el cliente: hasta 21 mensajes que alternan, empiezan y terminan
 * con la persona, y respetan los largos máximos.
 */
export function validateHistory(raw: unknown): Result<AgentMessage[], "historial_invalido"> {
  const parsed = z.array(messageSchema).min(1).max(MAX_HISTORY_MESSAGES).safeParse(raw);
  if (!parsed.success) return err("historial_invalido");
  const messages = parsed.data;
  const alternates = messages.every((m, i) => m.role === (i % 2 === 0 ? "user" : "assistant"));
  if (!alternates || messages[messages.length - 1]?.role !== "user") {
    return err("historial_invalido");
  }
  return ok(messages);
}

/**
 * Mensajes con un CV (de cualquier rol) → marcador fijo: el texto de un CV nunca vuelve al modelo,
 * ni en el resumen ni como fuente de fundamento. La ruta lo llama siempre, antes de resumir.
 */
export function sanitizeHistory(messages: readonly AgentMessage[]): AgentMessage[] {
  return messages.map((m) => (looksLikeCv(m.text) ? { ...m, text: CV_OMITTED_MARKER } : { ...m }));
}

/**
 * Lo que el cliente manda de las propuestas anteriores. Los campos son solo nombres de campo del
 * formulario (`country`, `level:react`), nunca texto libre: van al resumen que lee el modelo.
 */
export const proposalOutcomeSchema = z
  .object({
    destination: z.enum(PROPOSAL_DESTINATIONS),
    fields: z
      .array(z.string().regex(/^(?:[A-Za-z_]{1,40}|level:[a-z][a-z0-9_]{0,39}|level:\?)$/))
      .max(20),
    status: z.enum(["pendiente", "cargada", "descartada"]),
  })
  .strict();

export const proposalOutcomesSchema = z.array(proposalOutcomeSchema).max(20);

const SNIPPET_CHARS = 120;
const ROLE_NAME: Record<AgentMessage["role"], string> = { user: "Persona", assistant: "Asistente" };

/** Primeros 120 caracteres, cortando por code points (un emoji no queda partido). */
const snippet = (text: string): string => {
  const flat = Array.from(text.replace(/\s+/g, " ").trim());
  return flat.length > SNIPPET_CHARS ? `${flat.slice(0, SNIPPET_CHARS).join("")}…` : flat.join("");
};

/**
 * Recorta un texto desde el final (lo último que dijo la persona es lo que importa) a `max`
 * unidades UTF-16 como mucho, contando la «…», sin partir un code point.
 */
function keepTail(text: string, max: number): string {
  if (text.length <= max) return text;
  const points = Array.from(text);
  let tail = "";
  for (let i = points.length - 1; i >= 0; i--) {
    const next = points[i]! + tail;
    if (next.length + 1 > max) break;
    tail = next;
  }
  return `…${tail}`;
}

const intOr = (v: number | undefined, fallback: number): number =>
  v !== undefined && Number.isFinite(v) ? Math.floor(v) : fallback;

/**
 * Resumen determinista del historial (misma entrada → misma salida, sin LLM). Los últimos
 * `keepLast` mensajes van tal cual (si el primero sería del asistente, pasa al resumen); los anteriores, una línea por mensaje con sus primeros 120
 * caracteres, más una línea por propuesta con destino, campos y estado. Si no entra en `maxChars`
 * se quitan primero las líneas más viejas del resumen y después se acortan los recientes, desde el
 * más viejo (nunca se quitan: la alternancia de roles se conserva). El último mensaje de la persona se conserva siempre (recortado si hace falta).
 */
export function summarizeHistory(
  messages: readonly AgentMessage[],
  outcomes: readonly ProposalOutcome[],
  opts: { keepLast?: number; maxChars?: number } = {},
): { summary: string | null; recent: AgentMessage[] } {
  const keepLast = Math.max(1, intOr(opts.keepLast, 4));
  const maxChars = Math.max(200, intOr(opts.maxChars, 6000));
  let cut = Math.max(0, messages.length - keepLast);
  // Los recientes empiezan siempre con la persona (los proveedores lo exigen)
  if (messages[cut]?.role === "assistant") cut++;
  const older = messages.slice(0, cut);
  const recent = messages.slice(cut).map((m) => ({ ...m }));

  const lines = [
    ...older.map((m) => `${ROLE_NAME[m.role]}: ${snippet(m.text)}`),
    ...outcomes.map(
      (o) =>
        `Propuesta para ${o.destination} (${o.fields.join(", ") || "sin campos"}): ${o.status}`,
    ),
  ];

  const size = () =>
    lines.reduce((n, l) => n + l.length + 1, 0) + recent.reduce((n, m) => n + m.text.length, 0);

  while (size() > maxChars && lines.length > 0) lines.shift();
  for (let i = 0; i < recent.length && size() > maxChars; i++) {
    const m = recent[i]!;
    const excess = size() - maxChars;
    // Nunca vacío: un mensaje recortado del todo queda en «…» para no romper la alternancia
    m.text = keepTail(m.text, Math.max(1, m.text.length - excess));
  }
  return { summary: lines.length ? lines.join("\n") : null, recent };
}
