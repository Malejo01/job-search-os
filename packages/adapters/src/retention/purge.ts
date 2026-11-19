import { schema as s, type Db } from "@job-search-os/db";
import { inArray, isNotNull, isNull, lt, or, and } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import { sql, type SQL } from "drizzle-orm";
import { GMAIL_FORWARDING_PARSER, readIntegerSetting } from "@job-search-os/pipeline";
import { createLogger } from "../logger";
import { POOL_PARSER } from "../inbound/pool-mailbox";

/**
 * Purga programada (JS-107). Borra solo filas técnicas; nunca `raw_blobs`, `inbound_emails` ni
 * datos del usuario (esos se van con la cuenta). Excepciones: la cola del pool, sin dueño, y los crudos de
 * emails sin oferta asociada cuando `INBOUND_RAW_RETENTION_DAYS` está definida. `db` es la conexión de servicio:
 * ve las filas de todos los usuarios y el borrado es global por antigüedad, sin cruzar datos entre usuarios.
 */
export type PurgeResult = {
  tokens: number;
  llmCalls: number;
  queue: number;
  rejections: number;
  /** ip_hash de la lista de espera puestos en null (más de 24 h): se borra aunque nadie se anote */
  waitlistIps: number;
  /** Invitaciones vencidas y sin usar, borradas. */
  invitations: number;
  /** Invitaciones usadas a las que se les anuló el email. */
  invitationEmails: number;
  /** Comentarios de «Contanos qué pasó» de más de BETA_FEEDBACK_DAYS días. */
  betaFeedback: number;
  /** Emails de la cola manual del pool (sin dueño) con más de 30 días, con su crudo. */
  poolEmails: number;
  /** Crudos de emails de personas sin oferta asociada, más viejos que INBOUND_RAW_RETENTION_DAYS. */
  inboundRaw: number;
  /** Crudos de email sin fila ni oferta que los referencie, más viejos que INBOUND_RAW_RETENTION_DAYS. */
  inboundOrphans: number;
  /** Intentos de login con más de un día sin actividad. */
  loginAttempts: number;
};

export const POOL_EMAIL_RETENTION_DAYS = 30;

/** Retención de beta_feedback (C-23): 180 días, fija; no depende de `LEGAL_LOG_DAYS`. */
export const BETA_FEEDBACK_DAYS = 180;

const INVITATION_GRACE_DAYS = 7;

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

/**
 * Plazo de retención válido (`LEGAL_LOG_DAYS`, `INBOUND_RAW_RETENTION_DAYS`): entero de 1 a 3650. Ausente
 * o vacío desactiva la purga correspondiente; un valor que no se entiende (`30d`) también la desactiva,
 * pero registra un `error` para que no pase en silencio. `name` es el de la variable, para el aviso.
 */
export function parseLogDays(
  raw: string | undefined,
  name = "una variable de retención (LEGAL_LOG_DAYS o INBOUND_RAW_RETENTION_DAYS)",
): number | null {
  const { value, error } = readIntegerSetting(name, raw, 1, MAX_LOG_DAYS);
  if (error) createLogger({ task: "purge" }).error(error);
  return value;
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

/** Borra las filas del pool vencidas y sus raw_blobs, en lotes. Devuelve las filas de inbound_emails. */
async function purgePoolEmails(db: Db, cutoff: Date, batchSize: number): Promise<number> {
  let total = 0;
  for (let i = 0; i < PURGE_MAX_BATCHES; i++) {
    const rows = (await db.execute(sql`
      WITH old AS (
        SELECT id, raw_ref FROM inbound_emails
        WHERE user_id IS NULL AND parser = ${POOL_PARSER}
          AND received_at < ${cutoff.toISOString()}::timestamptz
        LIMIT ${batchSize}
      ),
      blobs AS (
        DELETE FROM raw_blobs
        WHERE user_id IS NULL AND 'pg:' || id::text IN (SELECT raw_ref FROM old)
      )
      DELETE FROM inbound_emails WHERE id IN (SELECT id FROM old) RETURNING id
    `)) as unknown as unknown[];
    total += rows.length;
    if (rows.length < batchSize) break;
  }
  return total;
}

/**
 * Borra los crudos viejos de emails de personas que ninguna oferta usa como fuente. La fila del email queda:
 * la bandeja sigue mostrando remitente, asunto y fecha.
 */
async function purgeInboundRaw(db: Db, cutoff: Date, batchSize: number): Promise<number> {
  let total = 0;
  for (let i = 0; i < PURGE_MAX_BATCHES; i++) {
    const rows = (await db.execute(sql`
      WITH old AS (
        SELECT b.id FROM inbound_emails e
        JOIN raw_blobs b ON e.raw_ref = 'pg:' || b.id::text AND b.user_id = e.user_id
        WHERE e.user_id IS NOT NULL
          AND b.kind = 'inbound_email'
          AND e.received_at < ${cutoff.toISOString()}::timestamptz
          AND NOT EXISTS (SELECT 1 FROM job_sources js WHERE js.raw_ref = e.raw_ref)
          -- Lo que /inbox muestra como pendiente (misma regla que \`inboxWhere.pendientes\`) todavía
          -- espera a la persona: retenido, confirmación de Gmail sin resolver, cola manual
          AND NOT (
            e.seen_at IS NULL AND e.dismissed_at IS NULL
            AND (e.error IS NOT NULL OR e.parser IS NULL OR e.parser IN ('none', ${GMAIL_FORWARDING_PARSER}))
          )
        LIMIT ${batchSize}
      )
      DELETE FROM raw_blobs WHERE id IN (SELECT id FROM old) RETURNING id
    `)) as unknown as unknown[];
    total += rows.length;
    if (rows.length < batchSize) break;
  }
  return total;
}

/**
 * Ids de los crudos de email huérfanos y vencidos: sin fila en `inbound_emails` que los referencie (el
 * insert que falló después de guardar el crudo) y sin oferta que los use. Un lote por consulta.
 */
export function orphanSelectSql(cutoff: Date, batchSize: number): SQL {
  return sql`
    SELECT b.id FROM raw_blobs b
    WHERE b.kind = 'inbound_email'
      AND b.created_at < ${cutoff.toISOString()}::timestamptz
      AND NOT EXISTS (SELECT 1 FROM inbound_emails e WHERE e.raw_ref = 'pg:' || b.id::text)
      AND NOT EXISTS (SELECT 1 FROM job_sources js WHERE js.raw_ref = 'pg:' || b.id::text)
    LIMIT ${batchSize}
  `;
}

/** Borra los crudos de email huérfanos más viejos que el plazo, en lotes. */
async function purgeOrphanInboundRaw(db: Db, cutoff: Date, batchSize: number): Promise<number> {
  let total = 0;
  for (let i = 0; i < PURGE_MAX_BATCHES; i++) {
    const rows = (await db.execute(sql`
      DELETE FROM raw_blobs
      WHERE id IN (${orphanSelectSql(cutoff, batchSize)})
      RETURNING id
    `)) as unknown as unknown[];
    total += rows.length;
    if (rows.length < batchSize) break;
  }
  return total;
}

/**
 * Un lote de la purga de intentos de login. Con `WHERE email_hash IN (subconsulta)` el planificador armaba un
 * hash semi join y recorría toda la tabla en cada lote. La subconsulta se materializa como arreglo
 * (`= ANY(ARRAY(...))`, se evalúa una vez): elige el lote por el índice de `last_attempt_at` y lo borra por la
 * clave, sin depender de lo grande que sea la tabla. Exportada para que el test de EXPLAIN mida este mismo SQL.
 */
export function loginAttemptsPurgeBatchSql(cutoff: Date, batchSize: number) {
  return sql`
    DELETE FROM login_attempts
    WHERE email_hash = ANY(ARRAY(
      SELECT email_hash FROM login_attempts
      WHERE last_attempt_at < ${cutoff.toISOString()}::timestamptz
      LIMIT ${batchSize}
    ))
    RETURNING email_hash
  `;
}

/**
 * Borra los intentos de login con más de un día sin actividad (la ventana de ADR-041), en lotes. La tabla no
 * tiene `user_id` ni columna `id`: la clave es el hash. Usa el índice por `last_attempt_at`.
 */
async function purgeLoginAttempts(db: Db, cutoff: Date, batchSize: number): Promise<number> {
  let total = 0;
  for (let i = 0; i < PURGE_MAX_BATCHES; i++) {
    const rows = (await db.execute(
      loginAttemptsPurgeBatchSql(cutoff, batchSize),
    )) as unknown as unknown[];
    total += rows.length;
    if (rows.length < batchSize) break;
  }
  return total;
}

export async function purgeExpired(
  db: Db,
  input: {
    now: Date;
    logDays?: number | null;
    /** Sin valor no se borra ningún crudo de personas: lo decide `INBOUND_RAW_RETENTION_DAYS`. */
    inboundRawDays?: number | null;
    batchSize?: number;
  },
): Promise<PurgeResult> {
  const { now } = input;
  const batchSize = input.batchSize ?? PURGE_BATCH;
  const dayAgo = new Date(now.getTime() - DAY_MS);
  const result: PurgeResult = {
    tokens: 0,
    llmCalls: 0,
    queue: 0,
    rejections: 0,
    waitlistIps: 0,
    invitations: 0,
    invitationEmails: 0,
    betaFeedback: 0,
    poolEmails: 0,
    inboundRaw: 0,
    inboundOrphans: 0,
    loginAttempts: 0,
  };

  // Intentos de login: corre aunque la purga técnica esté desactivada (no hay dato personal sin plazo)
  result.loginAttempts = await purgeLoginAttempts(db, dayAgo, batchSize);

  // IP hasheada de la lista de espera: no se guarda más de un día (mismo UPDATE que waitlist_join)
  const wiped = await db
    .update(s.waitlist)
    .set({ ipHash: null })
    .where(and(isNotNull(s.waitlist.ipHash), lt(s.waitlist.createdAt, dayAgo)))
    .returning({ id: s.waitlist.id });
  result.waitlistIps = wiped.length;

  // Tokens de reseteo: vencidos o usados hace más de 1 día
  result.tokens = await deleteInBatches(
    db,
    s.passwordResetTokens,
    or(lt(s.passwordResetTokens.expiresAt, dayAgo), lt(s.passwordResetTokens.usedAt, dayAgo)),
    batchSize,
  );

  // Invitaciones vencidas y sin usar, con 7 días de gracia para que el admin vea que vencieron
  const graceCutoff = new Date(now.getTime() - INVITATION_GRACE_DAYS * DAY_MS);
  result.invitations = await deleteInBatches(
    db,
    s.invitations,
    and(isNull(s.invitations.usedAt), lt(s.invitations.expiresAt, graceCutoff)),
    batchSize,
  );
  // Las usadas no guardan el email del invitado (las anteriores al canje que lo borra, todavía sí)
  const cleared = await db
    .update(s.invitations)
    .set({ email: null })
    .where(and(isNotNull(s.invitations.usedAt), isNotNull(s.invitations.email)))
    .returning({ id: s.invitations.id });
  result.invitationEmails = cleared.length;

  // Comentarios de la beta: retención propia, corre aunque la purga técnica esté desactivada
  result.betaFeedback = await deleteInBatches(
    db,
    s.betaFeedback,
    lt(s.betaFeedback.createdAt, new Date(now.getTime() - BETA_FEEDBACK_DAYS * DAY_MS)),
    batchSize,
  );

  // Cola manual del pool (ADR-024): sin dueño, se purga a los 30 días con su crudo. Acotada a
  // user_id NULL y al parser del pool: nunca toca emails de personas.
  result.poolEmails = await purgePoolEmails(
    db,
    new Date(now.getTime() - POOL_EMAIL_RETENTION_DAYS * DAY_MS),
    batchSize,
  );

  if (input.inboundRawDays) {
    const rawCutoff = new Date(now.getTime() - input.inboundRawDays * DAY_MS);
    result.inboundRaw = await purgeInboundRaw(db, rawCutoff, batchSize);
    result.inboundOrphans = await purgeOrphanInboundRaw(db, rawCutoff, batchSize);
  }

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
