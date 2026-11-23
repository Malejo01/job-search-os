import { schema as s, type Db } from "@job-search-os/db";
import { ROLE_KEYS } from "@job-search-os/pipeline";
import { and, asc, eq, isNull, like, or } from "drizzle-orm";
import type { Logger } from "../logger";
import { clampReason } from "../inbound/motivo";
import { parsePoolComputrabajoAlerts, readPoolAlertEmail } from "../inbound/pool-computrabajo";
import {
  POOL_MANUAL_QUEUE_REASON,
  POOL_PARSER,
  POOL_READER_FAILED_PREFIX,
} from "../inbound/pool-mailbox";
import type { InboundEmailContent } from "../inbound/parsers";
import { pgBlobStorage } from "../storage/blob";

/**
 * Reprocesar la cola del pool (R19-02, ADR-043): pasa por el lector los emails de las casillas `pool-*`
 * (`parser = pool_computrabajo_alerts`, `user_id` nulo) que quedaron en la cola manual y todavía tienen el
 * cuerpo guardado. Usa `readPoolAlertEmail`: no duplica el parser.
 *   - Idempotente: un email ya resuelto (sin `error`) no se vuelve a leer, y los avisos se deduplican por
 *     `(source_kind, external_id)` en el upsert.
 *   - Por lotes: `limit` emails por corrida.
 *   - `dryRun`: cuenta cuántos leería y cuántos fallan, sin escribir nada.
 *   - Fallar cerrado: el email que no se lee sigue en la cola, con el motivo.
 *   - Con el lector apagado no escribe (salvo dry-run).
 * Nunca lee ni loguea texto de los emails.
 */
export const REPROCESS_DEFAULT_LIMIT = 20;
export const REPROCESS_MAX_LIMIT = 200;
export const POOL_REPROCESS_NO_BODY_REASON =
  "casilla del pool: el cuerpo del email no está guardado o no se pudo leer: cola manual";

export type ReprocessArgs =
  | { ok: true; limit: number; dryRun: boolean; includeFailed: boolean; remote: boolean }
  | { ok: false; error: string };

const USAGE =
  "uso: pnpm pool:reprocess [--limit N] [--dry-run] [--include-failed] [--remote] (N entre 1 y 200)";

export function parseReprocessArgs(argv: readonly string[]): ReprocessArgs {
  let limit = REPROCESS_DEFAULT_LIMIT;
  let dryRun = false;
  let includeFailed = false;
  let remote = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--dry-run") dryRun = true;
    else if (a === "--include-failed") includeFailed = true;
    else if (a === "--remote") remote = true;
    else if (a === "--limit") {
      const raw = argv[++i];
      const n = raw !== undefined && /^\d{1,4}$/.test(raw) ? Number(raw) : NaN;
      if (!Number.isInteger(n) || n < 1 || n > REPROCESS_MAX_LIMIT) {
        return { ok: false, error: USAGE };
      }
      limit = n;
    } else return { ok: false, error: USAGE };
  }
  return { ok: true, limit, dryRun, includeFailed, remote };
}

export type ReprocessReport = {
  /** Emails de la cola elegidos en esta corrida (hasta `limit`). */
  selected: number;
  /** Con la estructura conocida: leídos (o que se leerían, en dry-run). */
  read: number;
  /** Que fallan cerrado: siguen en la cola. */
  failed: number;
  /** Sin cuerpo guardado o ilegible: no hay nada que leer. */
  noBody: number;
  /** Avisos que quedaron en el pool o ya estaban (0 en dry-run). */
  jobsExtracted: number;
  /** Leídos pero con avisos que fallaron al cargar: quedan en la cola con motivo. */
  partial: number;
};

export type ReprocessResult =
  | { ok: true; dryRun: boolean; readerEnabled: boolean; report: ReprocessReport }
  | { ok: false; error: string };

export type ReprocessOptions = {
  limit: number;
  dryRun: boolean;
  includeFailed?: boolean;
  /** `POOL_COMPUTRABAJO_READER === "1"`. Apagado, solo se permite el dry-run. */
  readerEnabled: boolean;
  logger: Logger;
  now?: () => Date;
};

type StoredPoolEmail = {
  content?: { html?: unknown; text?: unknown } | null;
  pool_career?: unknown;
};

function readStored(
  body: string | undefined,
): { html: string; text: string | null; career: string } | null {
  if (!body) return null;
  let stored: StoredPoolEmail;
  try {
    stored = JSON.parse(body) as StoredPoolEmail;
  } catch {
    return null;
  }
  const html = stored.content?.html;
  const career = stored.pool_career;
  if (typeof html !== "string" || !html) return null;
  if (typeof career !== "string" || !(ROLE_KEYS as readonly string[]).includes(career)) return null;
  const text = stored.content?.text;
  return { html, text: typeof text === "string" ? text : null, career };
}

export async function reprocessPoolQueue(db: Db, opts: ReprocessOptions): Promise<ReprocessResult> {
  if (!opts.dryRun && !opts.readerEnabled) {
    return {
      ok: false,
      error:
        "POOL_COMPUTRABAJO_READER no está en «1»: el lector está apagado y no se escribe nada. Probá con --dry-run.",
    };
  }
  const now = opts.now?.() ?? new Date();
  const t = s.inboundEmails;
  const t0 = {
    selected: 0,
    read: 0,
    failed: 0,
    noBody: 0,
    jobsExtracted: 0,
    partial: 0,
  } satisfies ReprocessReport;
  const report: ReprocessReport = { ...t0 };

  // Solo lo que sigue en la cola: sin leer (`POOL_MANUAL_QUEUE_REASON`), con avisos que fallaron al cargar y,
  // si se pide, lo que ya falló cerrado. Los resueltos (`error` null) y los de más tamaño (sin cuerpo) no entran.
  const rows = await db
    .select({
      id: t.id,
      fromAddress: t.fromAddress,
      subject: t.subject,
      rawRef: t.rawRef,
      receivedAt: t.receivedAt,
    })
    .from(t)
    .where(
      and(
        isNull(t.userId),
        eq(t.parser, POOL_PARSER),
        isNull(t.seenAt),
        isNull(t.dismissedAt),
        like(t.rawRef, "pg:%"),
        or(
          eq(t.error, POOL_MANUAL_QUEUE_REASON),
          like(t.error, "% avisos con error al cargar al pool"),
          opts.includeFailed ? like(t.error, `${POOL_READER_FAILED_PREFIX}%`) : undefined,
        ),
      ),
    )
    .orderBy(asc(t.receivedAt), asc(t.id))
    .limit(opts.limit);
  report.selected = rows.length;

  const storage = pgBlobStorage(db);
  for (const row of rows) {
    const blob = await storage.get(row.rawRef);
    const stored = readStored(blob?.body);
    if (!stored) {
      report.noBody++;
      // Se marca para que no vuelva a ocupar un lugar del tope en cada corrida
      if (!opts.dryRun) {
        await db
          .update(t)
          .set({ error: POOL_REPROCESS_NO_BODY_REASON })
          .where(and(eq(t.id, row.id), isNull(t.userId)));
      }
      continue;
    }
    const email: InboundEmailContent = {
      from: row.fromAddress,
      to: [],
      subject: row.subject,
      html: stored.html,
      text: stored.text,
      receivedAt: row.receivedAt,
    };

    if (opts.dryRun) {
      if (parsePoolComputrabajoAlerts(email).ok) report.read++;
      else report.failed++;
      continue;
    }

    const res = await readPoolAlertEmail({
      db,
      logger: opts.logger,
      email,
      career: stored.career,
      now,
    });
    const owned = and(eq(t.id, row.id), isNull(t.userId));
    if (!res.ok) {
      report.failed++;
      await db
        .update(t)
        .set({
          error: `${POOL_READER_FAILED_PREFIX} (${POOL_PARSER}): ${clampReason(res.reason)}. Cola manual`,
        })
        .where(owned);
      continue;
    }
    report.read++;
    report.jobsExtracted += res.jobsExtracted;
    if (res.errors) {
      report.partial++;
      await db
        .update(t)
        .set({
          jobsExtracted: res.jobsExtracted,
          error: `${res.errors} avisos con error al cargar al pool`,
        })
        .where(owned);
    } else {
      await db
        .update(t)
        .set({ jobsExtracted: res.jobsExtracted, error: null, seenAt: now })
        .where(owned);
    }
  }
  opts.logger.info({ ...report, dry_run: opts.dryRun }, "pool:reprocess: terminado");
  return { ok: true, dryRun: opts.dryRun, readerEnabled: opts.readerEnabled, report };
}

export function formatReprocessReport(r: Extract<ReprocessResult, { ok: true }>): string {
  const x = r.report;
  return [
    `lector: ${r.readerEnabled ? "prendido" : "apagado"}${r.dryRun ? " · dry-run (no se escribe nada)" : ""}`,
    `emails de la cola elegidos: ${x.selected}`,
    `${r.dryRun ? "se leerían" : "leídos"}: ${x.read}`,
    `fallan cerrado (siguen en la cola): ${x.failed}`,
    `sin cuerpo o ilegibles: ${x.noBody}`,
    ...(r.dryRun
      ? []
      : [`avisos en el pool: ${x.jobsExtracted}`, `leídos con avisos con error: ${x.partial}`]),
  ].join("\n");
}
