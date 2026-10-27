import { z } from "zod";
import { err, ok, type Result } from "../result";
import { AGENT_LIMITS } from "./limits";
import { PROPOSAL_DESTINATIONS, type ProposalDestination } from "./types";

/**
 * Historial del asistente. Las conversaciones no se guardan: el cliente manda el historial en cada
 * turno y acá se valida (es la frontera) y se resume sin LLM para que entre en el tope de entrada.
 */

export type AgentMessage = { role: "user" | "assistant"; text: string };

export type ProposalOutcome = {
  destination: ProposalDestination;
  fields: string[];
  status: "pendiente" | "cargada" | "descartada";
};

export const MAX_HISTORY_MESSAGES = 20;
export const MAX_ASSISTANT_MESSAGE_CHARS = 4_000;

const messageSchema = z.discriminatedUnion("role", [
  z
    .object({
      role: z.literal("user"),
      text: z.string().min(1).max(AGENT_LIMITS.maxUserMessageChars),
    })
    .strict(),
  z
    .object({ role: z.literal("assistant"), text: z.string().max(MAX_ASSISTANT_MESSAGE_CHARS) })
    .strict(),
]);

/**
 * Valida el historial que manda el cliente: hasta 20 mensajes que alternan, empiezan y terminan
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

export const proposalOutcomeSchema = z
  .object({
    destination: z.enum(PROPOSAL_DESTINATIONS),
    fields: z.array(z.string().max(80)).max(20),
    status: z.enum(["pendiente", "cargada", "descartada"]),
  })
  .strict();

const SNIPPET_CHARS = 120;
const ROLE_NAME: Record<AgentMessage["role"], string> = { user: "Persona", assistant: "Asistente" };

const snippet = (text: string): string => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > SNIPPET_CHARS ? `${flat.slice(0, SNIPPET_CHARS)}…` : flat;
};

/** Recorta un texto desde el final (lo último que dijo la persona es lo que importa). */
const keepTail = (text: string, max: number): string =>
  text.length <= max ? text : `…${text.slice(text.length - Math.max(0, max - 1))}`;

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
  const keepLast = Math.max(1, opts.keepLast ?? 4);
  const maxChars = Math.max(200, opts.maxChars ?? 6000);
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
