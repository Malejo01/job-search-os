import { schema as s, type Db } from "@job-search-os/db";
import { and, eq, isNull, like, or } from "drizzle-orm";
import { createLogger, type Logger } from "../logger";
import { pgBlobStorage } from "../storage/blob";
import { ingestEmailJobs, MANUAL_QUEUE_REASON } from "./handle";
import { chooseParserName, EMAIL_PARSERS, type EmailParser } from "./parsers";

/**
 * Reprocesar la cola manual con un parser nuevo. Los emails de una fuente que todavía no tenía
 * parser quedaron en `inbound_emails` con `parser = 'none'` (o el error de MANUAL_QUEUE_REASON) y
 * su crudo en raw_blobs. Cuando el parser existe, esto los vuelve a pasar por el mismo camino que
 * el webhook (parsear e ingestar con `ingestEmailJobs`) y actualiza la fila.
 *
 * - Solo toma filas sin descartar cuyo remitente hoy elige ese parser; el resto no se toca.
 *   También las que ya quedaron con ese parser y el error «estructura no reconocida (<parser>)».
 * - Si el crudo no tiene cuerpo (remitente que en su momento no era esperado: se guardó solo
 *   remitente, asunto y fecha), no hay nada que parsear y la fila queda como estaba. Esos
 *   emails viejos no se recuperan: el cuerpo nunca se guardó.
 * - El dry-run no mira criterios: no avisa de un usuario sin criterios activos (ingestFailed
 *   solo se ve al escribir).
 * - Si el parser vuelve a fallar, la fila queda como estaba.
 * - Idempotente: una fila reprocesada pasa a `parser = <nombre>` y no se vuelve a elegir; además
 *   la ingesta deduplica por (fuente, id externo).
 * - Devuelve solo conteos: nunca asunto, remitente completo ni links.
 */
export type ReprocessOptions = {
  parser: EmailParser["name"];
  userId?: string;
  /** Parsea y cuenta, pero no ingesta ni actualiza nada. */
  dryRun?: boolean;
  logger?: Logger;
  now?: () => Date;
};

export type ReprocessResult = {
  parser: EmailParser["name"];
  dryRun: boolean;
  /** Filas de la cola manual que hoy elegirían este parser. */
  candidates: number;
  /** Emails que el parser pudo leer (en dry-run, los que se reprocesarían). */
  parsed: number;
  /** Ofertas nuevas o fusionadas (en dry-run, las que el parser extrajo). */
  jobs: number;
  /** El parser volvió a fallar: la fila queda como estaba. */
  stillFailing: number;
  /** El crudo no tiene cuerpo: no hay nada que parsear. */
  withoutBody: number;
  /** La ingesta no pudo cargar nada (por ejemplo, usuario sin criterios): la fila queda como estaba. */
  ingestFailed: number;
};

type StoredRaw = { content?: { html?: string | null; text?: string | null } | null };

export async function reprocessManualQueue(
  db: Db,
  options: ReprocessOptions,
): Promise<ReprocessResult> {
  const parser = EMAIL_PARSERS[options.parser];
  if (!parser) throw new Error(`no hay parser registrado para «${options.parser}»`);
  const dryRun = options.dryRun ?? false;
  const logger = options.logger ?? createLogger();
  const storage = pgBlobStorage(db);

  const rows = await db
    .select()
    .from(s.inboundEmails)
    .where(
      and(
        or(
          eq(s.inboundEmails.parser, "none"),
          eq(s.inboundEmails.error, MANUAL_QUEUE_REASON),
          // Falló con este mismo parser (estructura no reconocida): puede andar con una versión nueva
          and(
            eq(s.inboundEmails.parser, options.parser),
            like(s.inboundEmails.error, `estructura no reconocida (${options.parser})%`),
          ),
        ),
        isNull(s.inboundEmails.dismissedAt),
        options.userId ? eq(s.inboundEmails.userId, options.userId) : undefined,
      ),
    )
    .orderBy(s.inboundEmails.receivedAt);

  const result: ReprocessResult = {
    parser: options.parser,
    dryRun,
    candidates: 0,
    parsed: 0,
    jobs: 0,
    stillFailing: 0,
    withoutBody: 0,
    ingestFailed: 0,
  };

  for (const row of rows) {
    if (!row.userId || chooseParserName(row.fromAddress) !== options.parser) continue;
    result.candidates++;
    const log = logger.child({ user_id: row.userId, email_row: row.id });

    const blob = await storage.get(row.rawRef);
    let raw: StoredRaw | null;
    try {
      raw = blob ? (JSON.parse(blob.body) as StoredRaw) : null;
    } catch {
      raw = null;
    }
    const html = raw?.content?.html ?? null;
    const text = raw?.content?.text ?? null;
    if (!html && !text) {
      result.withoutBody++;
      continue;
    }

    const parsed = parser.parse({
      from: row.fromAddress,
      to: [],
      subject: row.subject,
      html,
      text,
      receivedAt: row.receivedAt,
    });
    if (!parsed.ok) {
      result.stillFailing++;
      continue;
    }
    result.parsed++;
    if (dryRun) {
      result.jobs += parsed.jobs.length;
      continue;
    }

    const now = options.now?.() ?? new Date();
    const ingested = parsed.jobs.length
      ? await ingestEmailJobs(db, {
          userId: row.userId,
          jobs: parsed.jobs,
          rawRef: row.rawRef,
          logger: log,
          now,
        })
      : { jobsExtracted: 0, error: null };
    if (ingested.error && ingested.jobsExtracted === 0) {
      result.parsed--;
      result.ingestFailed++;
      continue;
    }
    result.jobs += ingested.jobsExtracted;
    await db
      .update(s.inboundEmails)
      .set({
        parser: options.parser,
        jobsExtracted: ingested.jobsExtracted,
        error: ingested.error,
        // Igual que el webhook: resuelto solo si extrajo avisos sin error
        seenAt: ingested.jobsExtracted > 0 && ingested.error === null ? now : row.seenAt,
      })
      .where(eq(s.inboundEmails.id, row.id));
  }

  logger.info({ ...result, user_id: options.userId ?? null }, "inbound: cola manual reprocesada");
  return result;
}
