import { schema as s, type Db } from "@job-search-os/db";
import { ASSISTANT_TASK, drizzleCallSink, type CallSink } from "@job-search-os/adapters";
import { ASSISTANT_WINDOW_DAYS } from "@job-search-os/pipeline";
import { and, eq, gte, like, sql } from "drizzle-orm";
import { withUser } from "./db";

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
        n: sql<number>`count(*)::int`,
        cost: sql<number>`coalesce(sum(${s.llmCalls.costUsd}), 0)::float8`,
        unknown: sql<boolean>`coalesce(bool_or(${s.llmCalls.costUsd} is null), false)`,
      })
      .from(s.llmCalls)
      .where(
        and(
          eq(s.llmCalls.userId, userId),
          eq(s.llmCalls.task, ASSISTANT_TASK),
          eq(s.llmCalls.label, label),
        ),
      );
    const rows = conv?.n ?? 0;
    return {
      monthlyConversations: month?.n ?? 0,
      conversationRows: rows,
      conversationCostUsd: rows === 0 ? 0 : conv?.unknown ? null : Number(conv?.cost ?? NaN),
    };
  });
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
