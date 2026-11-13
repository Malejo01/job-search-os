import { schema as s, type Db } from "@job-search-os/db";
import { ASSISTANT_TASK, drizzleCallSink, type CallSink } from "@job-search-os/adapters";
import {
  ASSISTANT_EVENT_MODEL,
  ASSISTANT_EVENT_TASK,
  ASSISTANT_TURN_MARKER,
  ASSISTANT_WINDOW_DAYS,
} from "@job-search-os/pipeline";
import { and, eq, gte, inArray, like, sql } from "drizzle-orm";
import { withUser } from "./db";

/** Filas de pasos del modelo (no marcadores): lo único que cuenta para el costo y las filas. */
const isChat = sql`${s.llmCalls.task} = ${ASSISTANT_TASK}`;

/**
 * Uso del asistente, siempre desde `llm_calls` y en el servidor (contrato de `checkTurnStart`):
 * nada de esto sale de lo que manda el navegador. Las charlas no se guardan; su única huella es la
 * etiqueta `conv:<id>` en las filas de `llm_calls`, sin contenido.
 */
export type AssistantUsage = {
  /** Charlas distintas de los últimos 30 días (labels `conv:%` de la tarea del asistente). */
  monthlyConversations: number;
  /** Filas que ya tiene esta charla: 0 = charla nueva. */
  conversationRows: number;
  /** Turnos aceptados de esta charla según los marcadores `turn`; piso del historial del cliente. */
  conversationTurns: number;
  /** Gasto de esta charla; null si alguna fila no tiene costo (falla cerrado: cost_unknown). */
  conversationCostUsd: number | null;
};

export async function loadAssistantUsage(
  userId: string,
  label: string,
  now: Date,
): Promise<AssistantUsage> {
  const since = new Date(now.getTime() - ASSISTANT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  return withUser(userId, async (tx) => {
    const [month] = await tx
      .select({ n: sql<number>`count(distinct ${s.llmCalls.label})::int` })
      .from(s.llmCalls)
      .where(
        and(
          eq(s.llmCalls.userId, userId),
          eq(s.llmCalls.task, ASSISTANT_TASK),
          like(s.llmCalls.label, "conv:%"),
          gte(s.llmCalls.createdAt, since),
        ),
      );
    const [conv] = await tx
      .select({
        n: sql<number>`(count(*) filter (where ${isChat}))::int`,
        cost: sql<number>`coalesce(sum(${s.llmCalls.costUsd}) filter (where ${isChat}), 0)::float8`,
        unknown: sql<boolean>`coalesce(bool_or(${s.llmCalls.costUsd} is null) filter (where ${isChat}), false)`,
        // Turnos ya aceptados según el servidor: piso del conteo del historial del navegador
        markerTurns: sql<number>`(count(*) filter (where ${s.llmCalls.task} = ${ASSISTANT_EVENT_TASK} and ${s.llmCalls.promptVersion} = ${ASSISTANT_TURN_MARKER}))::int`,
      })
      .from(s.llmCalls)
      .where(
        and(
          eq(s.llmCalls.userId, userId),
          inArray(s.llmCalls.task, [ASSISTANT_TASK, ASSISTANT_EVENT_TASK]),
          eq(s.llmCalls.label, label),
        ),
      );
    const rows = conv?.n ?? 0;
    return {
      monthlyConversations: month?.n ?? 0,
      conversationRows: rows,
      conversationTurns: conv?.markerTurns ?? 0,
      conversationCostUsd: rows === 0 ? 0 : conv?.unknown ? null : Number(conv?.cost ?? NaN),
    };
  });
}

/**
 * Fila marcadora de costo 0 para medir las charlas sin migración (ver `metrics.ts` en pipeline):
 * tarea `assistant_event`, motivo (`turn` o `cap:<motivo>`) en `prompt_version`, `error` null. Sin
 * contenido. Si no se puede escribir, se sigue: medir nunca frena al asistente.
 */
export async function recordAssistantMarker(
  userId: string,
  label: string,
  marker: string,
): Promise<boolean> {
  try {
    await assistantCallSink(userId).record({
      userId,
      task: ASSISTANT_EVENT_TASK,
      model: ASSISTANT_EVENT_MODEL,
      promptVersion: marker,
      jobId: null,
      tokensIn: null,
      tokensOut: null,
      tokensReasoning: null,
      latencyMs: 0,
      costUsd: 0,
      label,
      ok: true,
      error: null,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * `llm_calls` con el rol de la app: cada fila en su propia transacción corta con `app.user_id`
 * (RLS de dueño), sin mantener una transacción abierta mientras el modelo responde.
 */
export function assistantCallSink(userId: string): CallSink {
  return {
    async record(call) {
      await withUser(userId, (tx) => drizzleCallSink(tx as unknown as Db).record(call));
    },
  };
}
