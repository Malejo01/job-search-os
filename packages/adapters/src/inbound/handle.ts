import { schema as s, type Db } from "@job-search-os/db";
import type { CriteriaRules } from "@job-search-os/pipeline";
import { and, desc, eq, gte, like, sql } from "drizzle-orm";
import { ingestBatch } from "../ingest/ingest-job";
import type { Logger } from "../logger";
import { enqueueEvaluationWith } from "../queue/pg-queue";
import { loadTaxonomy } from "../skills/sync";
import type { BlobStorage } from "../storage/blob";
import { chooseParserName, EMAIL_PARSERS, type InboundEmailContent } from "./parsers";
import type { ReceivedEmailContent, ResendReceivedEvent } from "./resend";

/**
 * Un email entrante (JS-020): resolver el usuario por la dirección de destino
 * (profiles.inbound_address), guardar el crudo en storage, dejar la fila en inbound_emails y
 * despachar por remitente. Sin parser o con estructura no reconocida → cola manual (fila con
 * `error`, jobs_extracted 0), nunca campos inventados. Corre como servicio (dueño).
 */
export type InboundDeps = {
  db: Db;
  storage: BlobStorage;
  logger: Logger;
  /** Máximo de emails por usuario en una hora (ARCHITECTURE §8). */
  hourlyLimit?: number;
  now?: () => Date;
};

export type InboundOutcome =
  | { kind: "duplicate"; inboundId: string }
  | { kind: "unknown_recipient"; recipients: string[] }
  | { kind: "rate_limited"; userId: string }
  | {
      kind: "stored";
      inboundId: string;
      userId: string;
      parser: string | null;
      jobsExtracted: number;
      error: string | null;
    };

export const MANUAL_QUEUE_REASON = "sin parser para este remitente: cola manual";

export async function handleInboundEmail(
  event: ResendReceivedEvent,
  content: ReceivedEmailContent | null,
  rawBody: string,
  deps: InboundDeps,
): Promise<InboundOutcome> {
  const { db } = deps;
  const now = deps.now?.() ?? new Date();
  const log = deps.logger.child({ email_id: event.data.email_id, from: event.data.from });

  // Idempotencia: Svix reintenta; el mismo email_id no se guarda dos veces
  const [dup] = await db
    .select({ id: s.inboundEmails.id })
    .from(s.inboundEmails)
    .innerJoin(s.rawBlobs, sql`${s.inboundEmails.rawRef} = 'pg:' || ${s.rawBlobs.id}::text`)
    .where(like(s.rawBlobs.body, `%"email_id":"${event.data.email_id}"%`))
    .limit(1);
  if (dup) return { kind: "duplicate", inboundId: dup.id };

  // Usuario por dirección de destino (u_<id>@ingest.<dominio>)
  const recipients = [...event.data.to, ...event.data.received_for, ...event.data.cc].map((r) =>
    (/<([^>]+)>/.exec(r)?.[1] ?? r).trim().toLowerCase(),
  );
  const profiles = recipients.length
    ? await db
        .select({ userId: s.profiles.userId, inboundAddress: s.profiles.inboundAddress })
        .from(s.profiles)
        .where(sql`lower(${s.profiles.inboundAddress}) in ${recipients}`)
    : [];
  const profile = profiles[0];
  if (!profile) {
    log.warn({ recipients }, "inbound: destinatario sin usuario");
    return { kind: "unknown_recipient", recipients };
  }
  const userId = profile.userId;

  const countRows = (await db
    .select({ count: sql<number>`count(*)::int` })
    .from(s.inboundEmails)
    .where(
      and(
        eq(s.inboundEmails.userId, userId),
        gte(s.inboundEmails.receivedAt, new Date(now.getTime() - 60 * 60 * 1000)),
      ),
    )) as { count: number }[];
  const count = countRows[0]?.count ?? 0;
  if (count >= (deps.hourlyLimit ?? 100)) {
    log.warn({ user_id: userId, count }, "inbound: rate limit por usuario");
    return { kind: "rate_limited", userId };
  }

  const rawRef = await deps.storage.put({
    userId,
    kind: "inbound_email",
    contentType: "application/json",
    body: JSON.stringify({ event: JSON.parse(rawBody), content }),
  });

  const parserName = chooseParserName(event.data.from);
  const parser = EMAIL_PARSERS[parserName];
  let jobsExtracted = 0;
  let error: string | null = null;
  let parserUsed: string | null = null;

  if (!parser) {
    error = MANUAL_QUEUE_REASON;
  } else if (!content) {
    error = "sin cuerpo del email (falta RESEND_API_KEY para pedirlo): cola manual";
  } else {
    parserUsed = parser.name;
    const email: InboundEmailContent = {
      from: event.data.from,
      to: recipients,
      subject: event.data.subject ?? null,
      html: content.html,
      text: content.text,
      receivedAt: now,
    };
    const parsed = parser.parse(email);
    if (!parsed.ok) {
      error = `estructura no reconocida (${parser.name}): ${parsed.reason}. Cola manual`;
    } else if (parsed.jobs.length) {
      const [criteria] = await db
        .select({ rules: s.evaluationCriteria.rules })
        .from(s.evaluationCriteria)
        .where(and(eq(s.evaluationCriteria.userId, userId), eq(s.evaluationCriteria.active, true)))
        .orderBy(desc(s.evaluationCriteria.version))
        .limit(1);
      if (!criteria) {
        error = "usuario sin criterios activos";
      } else {
        const summary = await ingestBatch(parsed.jobs, {
          db,
          userId,
          rules: criteria.rules as CriteriaRules,
          logger: log,
          enqueueEvaluation: enqueueEvaluationWith(db),
          now: () => now,
          taxonomy: await loadTaxonomy(db),
        });
        jobsExtracted = summary.inserted + summary.merged;
        if (summary.errors.length) error = `${summary.errors.length} avisos con error al ingestar`;
      }
    }
  }

  const [row] = await db
    .insert(s.inboundEmails)
    .values({
      userId,
      fromAddress: event.data.from,
      subject: event.data.subject ?? null,
      rawRef,
      parser: parserUsed ?? (parser ? parserName : "none"),
      jobsExtracted,
      error,
      receivedAt: now,
    })
    .returning({ id: s.inboundEmails.id });
  log.info(
    { user_id: userId, parser: parserUsed, jobs_extracted: jobsExtracted, error },
    "inbound: guardado",
  );
  return {
    kind: "stored",
    inboundId: row!.id,
    userId,
    parser: parserUsed,
    jobsExtracted,
    error,
  };
}
