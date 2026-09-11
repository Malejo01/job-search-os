import { schema as s, type Db } from "@job-search-os/db";
import { and, eq, sql } from "drizzle-orm";

/**
 * Cola de trabajo sobre Postgres con `FOR UPDATE SKIP LOCKED` (ARCHITECTURE §2: adapter
 * `queue`, hoy Postgres, mañana SQS con la misma interfaz). DEUDA: pgmq no existe en Neon
 * (ADR-009), por eso una tabla propia; si más adelante hay pgmq o SQS, se cambia el adapter.
 */
export type QueueMessage<T = Record<string, unknown>> = {
  id: string;
  queue: string;
  userId: string | null;
  payload: T;
  attempts: number;
  maxAttempts: number;
};

export type EnqueueOptions = { userId?: string | null; runAfter?: Date; maxAttempts?: number };

export interface Queue {
  enqueue<T extends Record<string, unknown>>(
    queue: string,
    payload: T,
    options?: EnqueueOptions,
  ): Promise<string>;
  /** Toma hasta `limit` mensajes pendientes y los marca `processing`; otros workers no los ven. */
  dequeue<T extends Record<string, unknown>>(
    queue: string,
    limit: number,
  ): Promise<QueueMessage<T>[]>;
  ack(id: string): Promise<void>;
  /**
   * Marca el intento fallido: reintenta con backoff si quedan intentos, si no `failed`.
   * `final: true` lo cierra en el primer intento (job inexistente: ningún reintento lo arregla).
   */
  fail(
    id: string,
    error: string,
    options?: { retryInSeconds?: number; final?: boolean },
  ): Promise<"retry" | "failed">;
  /** Devuelve UN mensaje a `pending` sin consumir intento (el worker no llegó a procesarlo: tope de gasto, señal). */
  release(id: string, note: string): Promise<void>;
  /** Devuelve a `pending` los `processing` colgados hace más de `olderThanSeconds` (worker caído). */
  requeueStale(queue: string, olderThanSeconds: number): Promise<number>;
  stats(queue: string): Promise<Record<string, number>>;
}

export const EVALUATE_QUEUE = "evaluate_job";
export type EvaluatePayload = { jobId: string };

export function createPgQueue(db: Db): Queue {
  return {
    async enqueue(queue, payload, options = {}) {
      const [row] = await db
        .insert(s.jobQueue)
        .values({
          queue,
          userId: options.userId ?? null,
          payload,
          runAfter: options.runAfter ?? new Date(),
          maxAttempts: options.maxAttempts ?? 3,
        })
        .returning({ id: s.jobQueue.id });
      return row!.id;
    },

    async dequeue<T extends Record<string, unknown>>(queue: string, limit: number) {
      // Un solo statement: selecciona con SKIP LOCKED y marca processing en la misma transacción
      const rows = await db.execute<{
        id: string;
        queue: string;
        user_id: string | null;
        payload: T;
        attempts: number;
        max_attempts: number;
      }>(sql`
        UPDATE job_queue SET status = 'processing', locked_at = now(), attempts = attempts + 1, updated_at = now()
        WHERE id IN (
          SELECT id FROM job_queue
          WHERE queue = ${queue} AND status = 'pending' AND run_after <= now()
          ORDER BY run_after, created_at
          FOR UPDATE SKIP LOCKED
          LIMIT ${limit}
        )
        RETURNING id, queue, user_id, payload, attempts, max_attempts
      `);
      return [...rows].map((r) => ({
        id: r.id,
        queue: r.queue,
        userId: r.user_id,
        payload: r.payload,
        attempts: r.attempts,
        maxAttempts: r.max_attempts,
      }));
    },

    async ack(id) {
      await db
        .update(s.jobQueue)
        .set({ status: "done", lockedAt: null, updatedAt: new Date() })
        .where(eq(s.jobQueue.id, id));
    },

    async fail(id, error, options = {}) {
      const [row] = await db
        .select({ attempts: s.jobQueue.attempts, maxAttempts: s.jobQueue.maxAttempts })
        .from(s.jobQueue)
        .where(eq(s.jobQueue.id, id))
        .limit(1);
      if (!row) return "failed";
      // final: descartar en el primer intento (job inexistente), sin reintentar hasta agotar
      const exhausted = options.final === true || row.attempts >= row.maxAttempts;
      const retryIn = options.retryInSeconds ?? Math.min(3600, 60 * 2 ** (row.attempts - 1));
      await db
        .update(s.jobQueue)
        .set({
          status: exhausted ? "failed" : "pending",
          runAfter: exhausted ? undefined : new Date(Date.now() + retryIn * 1000),
          lockedAt: null,
          lastError: error.slice(0, 2000),
          updatedAt: new Date(),
        })
        .where(eq(s.jobQueue.id, id));
      return exhausted ? "failed" : "retry";
    },

    async release(id, note) {
      await db
        .update(s.jobQueue)
        .set({
          status: "pending",
          attempts: sql`greatest(${s.jobQueue.attempts} - 1, 0)`,
          runAfter: new Date(),
          lockedAt: null,
          lastError: note.slice(0, 2000),
          updatedAt: new Date(),
        })
        .where(and(eq(s.jobQueue.id, id), eq(s.jobQueue.status, "processing")));
    },

    async requeueStale(queue, olderThanSeconds) {
      const result = await db
        .update(s.jobQueue)
        .set({ status: "pending", lockedAt: null, updatedAt: new Date() })
        .where(
          and(
            eq(s.jobQueue.queue, queue),
            eq(s.jobQueue.status, "processing"),
            sql`locked_at < now() - make_interval(secs => ${olderThanSeconds})`,
          ),
        )
        .returning({ id: s.jobQueue.id });
      return result.length;
    },

    async stats(queue) {
      const rows = await db
        .select({ status: s.jobQueue.status, n: sql<number>`count(*)::int` })
        .from(s.jobQueue)
        .where(eq(s.jobQueue.queue, queue))
        .groupBy(s.jobQueue.status);
      return Object.fromEntries(rows.map((r) => [r.status, r.n]));
    },
  };
}

/** Helper para la ingesta: encola la evaluación de un job (idempotente si ya hay una pendiente). */
export function enqueueEvaluationWith(db: Db, queue: Queue = createPgQueue(db)) {
  return async (jobId: string, userId?: string | null): Promise<void> => {
    const pending = await db
      .select({ id: s.jobQueue.id })
      .from(s.jobQueue)
      .where(
        and(
          eq(s.jobQueue.queue, EVALUATE_QUEUE),
          sql`${s.jobQueue.status} in ('pending', 'processing')`,
          sql`${s.jobQueue.payload}->>'jobId' = ${jobId}`,
        ),
      )
      .limit(1);
    if (pending.length) return;
    await queue.enqueue<EvaluatePayload>(EVALUATE_QUEUE, { jobId }, { userId: userId ?? null });
  };
}
