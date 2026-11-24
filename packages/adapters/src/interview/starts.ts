import { schema as s, type Db } from "@job-search-os/db";
import { and, eq, gte, like } from "drizzle-orm";
import { LLM_RESERVE_TASK } from "../llm/spend";
import { LLM_RESERVE_TTL_MS } from "../llm/spend-reserve";

/**
 * Cuántas simulaciones empezó una persona en las últimas 24 horas, para el tope diario. Las cuenta por tres
 * fuentes y las junta por id de simulación (cada una cuenta una sola vez):
 * - las filas vivas de `interview_sessions`;
 * - las reservas de arranque vivas (un pedido en curso que todavía no guardó su fila);
 * - las llamadas registradas en `llm_calls` que generaron las preguntas (`interview_questions`, ok), que
 *   **sobreviven al borrado de la simulación**: borrar una no libera cupo (R23-02).
 */
export const INTERVIEW_LABEL_PREFIX = "interview:";
/** Etiqueta de la reserva de arranque: distinta de la de las respuestas, que no cuentan como simulación nueva. */
export const INTERVIEW_START_LABEL_PREFIX = "interview_start:";
/** Tarea de `model_routing` que genera las cinco preguntas: marca el inicio de una simulación. */
export const INTERVIEW_QUESTIONS_TASK = "interview_questions";

const DAY_MS = 24 * 60 * 60 * 1000;

/** `db` puede ser una transacción de la app (RLS de dueño sobre `llm_calls`) o la conexión de servicio. */
export async function startedInterviewTimes(
  db: Db,
  userId: string,
  now: Date,
): Promise<Map<string, Date>> {
  const since = new Date(now.getTime() - DAY_MS);
  const created = await db
    .select({ id: s.interviewSessions.id, at: s.interviewSessions.createdAt })
    .from(s.interviewSessions)
    .where(and(eq(s.interviewSessions.userId, userId), gte(s.interviewSessions.createdAt, since)));
  const live = await db
    .select({ label: s.llmCalls.label, at: s.llmCalls.createdAt })
    .from(s.llmCalls)
    .where(
      and(
        eq(s.llmCalls.userId, userId),
        eq(s.llmCalls.task, LLM_RESERVE_TASK),
        like(s.llmCalls.label, `${INTERVIEW_START_LABEL_PREFIX}%`),
        gte(s.llmCalls.createdAt, new Date(now.getTime() - LLM_RESERVE_TTL_MS)),
      ),
    );
  const generated = await db
    .select({ label: s.llmCalls.label, at: s.llmCalls.createdAt })
    .from(s.llmCalls)
    .where(
      and(
        eq(s.llmCalls.userId, userId),
        eq(s.llmCalls.task, INTERVIEW_QUESTIONS_TASK),
        eq(s.llmCalls.ok, true),
        like(s.llmCalls.label, `${INTERVIEW_LABEL_PREFIX}%`),
        gte(s.llmCalls.createdAt, since),
      ),
    );
  // Por id de simulación, con el instante más temprano en que se la vio empezar
  const started = new Map<string, Date>();
  const add = (id: string, at: Date) => {
    if (id === "") return;
    const prev = started.get(id);
    if (!prev || at.getTime() < prev.getTime()) started.set(id, at);
  };
  for (const row of created) add(row.id, row.at);
  for (const row of live) add((row.label ?? "").slice(INTERVIEW_START_LABEL_PREFIX.length), row.at);
  for (const row of generated) add((row.label ?? "").slice(INTERVIEW_LABEL_PREFIX.length), row.at);
  return started;
}

export async function startedInterviewIds(db: Db, userId: string, now: Date): Promise<Set<string>> {
  return new Set((await startedInterviewTimes(db, userId, now)).keys());
}

/** Simulaciones empezadas en las últimas 24 horas, borradas incluidas. */
export async function countInterviewStarts(db: Db, userId: string, now: Date): Promise<number> {
  return (await startedInterviewIds(db, userId, now)).size;
}

/** Instantes de inicio de las simulaciones de las últimas 24 horas (borradas incluidas), para saber cuándo vuelve un cupo. */
export async function interviewStartTimes(db: Db, userId: string, now: Date): Promise<Date[]> {
  return [...(await startedInterviewTimes(db, userId, now)).values()];
}
