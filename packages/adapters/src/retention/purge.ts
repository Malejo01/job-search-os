import { schema as s, type Db } from "@job-search-os/db";
import { inArray, lt, or, and } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

/**
 * Purga programada (JS-107). Borra solo filas técnicas; nunca `raw_blobs`, `inbound_emails` ni
 * datos del usuario (esos se van con la cuenta). `db` es la conexión de servicio: ve las filas de
 * todos los usuarios y el borrado es global por antigüedad, sin cruzar datos entre usuarios.
 */
export type PurgeResult = { tokens: number; llmCalls: number; queue: number; rejections: number };

export const PURGE_BATCH = 5_000;
/** Tope de lotes por tabla y corrida; lo que quede lo borra la próxima (cada 6 h). */
export const PURGE_MAX_BATCHES = 10;
const DAY_MS = 24 * 60 * 60 * 1000;
/**
 * `llm_calls` es el único registro de gasto: tiene un mínimo propio aunque `logDays` sea menor
 * (decisión conservadora; cubre de sobra la ventana del tope diario). Mauro puede cambiarlo.
 */
export const MIN_LLM_CALLS_DAYS = 90;
/** Los rechazos del webhook se muestran en /inbox con una ventana de 2 días: no se borran antes. */
export const MIN_REJECTIONS_DAYS = 2;
const MAX_LOG_DAYS = 3650;

/** `LEGAL_LOG_DAYS` válido: entero de 1 a 3650; cualquier otra cosa desactiva la purga técnica. */
export function parseLogDays(raw: string | undefined): number | null {
  if (raw === undefined || !/^\d+$/.test(raw.trim())) return null;
  const n = Number(raw.trim());
  return n >= 1 && n <= MAX_LOG_DAYS ? n : null;
}

/** Borra en lotes (máximo PURGE_MAX_BATCHES) para no tomar locks largos; devuelve el total borrado. */
async function deleteInBatches(
  db: Db,
  table: PgTable & { id: AnyPgColumn },
  where: SQL | undefined,
  batchSize: number,
): Promise<number> {
  let total = 0;
  for (let i = 0; i < PURGE_MAX_BATCHES; i++) {
    const rows = await db
      .delete(table)
      .where(
        inArray(table.id, db.select({ id: table.id }).from(table).where(where).limit(batchSize)),
      )
      .returning({ id: table.id });
    total += rows.length;
    if (rows.length < batchSize) break;
  }
  return total;
}

export async function purgeExpired(
  db: Db,
  input: { now: Date; logDays?: number | null; batchSize?: number },
): Promise<PurgeResult> {
  const { now } = input;
  const batchSize = input.batchSize ?? PURGE_BATCH;
  const dayAgo = new Date(now.getTime() - DAY_MS);
  const result: PurgeResult = { tokens: 0, llmCalls: 0, queue: 0, rejections: 0 };

  // Tokens de reseteo: vencidos o usados hace más de 1 día
  result.tokens = await deleteInBatches(
    db,
    s.passwordResetTokens,
    or(lt(s.passwordResetTokens.expiresAt, dayAgo), lt(s.passwordResetTokens.usedAt, dayAgo)),
    batchSize,
  );

  const logDays = input.logDays;
  if (
    typeof logDays !== "number" ||
    !Number.isInteger(logDays) ||
    logDays < 1 ||
    logDays > MAX_LOG_DAYS
  ) {
    return result;
  }
  const cutoff = new Date(now.getTime() - logDays * DAY_MS);
  const llmCutoff = new Date(now.getTime() - Math.max(logDays, MIN_LLM_CALLS_DAYS) * DAY_MS);

  const rejectionsCutoff = new Date(
    now.getTime() - Math.max(logDays, MIN_REJECTIONS_DAYS) * DAY_MS,
  );

  result.llmCalls = await deleteInBatches(
    db,
    s.llmCalls,
    lt(s.llmCalls.createdAt, llmCutoff),
    batchSize,
  );
  // Solo estados finales; lo pendiente o en curso no se toca. updated_at = cuándo terminó.
  result.queue = await deleteInBatches(
    db,
    s.jobQueue,
    and(inArray(s.jobQueue.status, ["done", "failed"]), lt(s.jobQueue.updatedAt, cutoff)),
    batchSize,
  );
  result.rejections = await deleteInBatches(
    db,
    s.inboundRejections,
    lt(s.inboundRejections.windowStart, rejectionsCutoff),
    batchSize,
  );
  return result;
}
