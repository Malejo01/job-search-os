import { schema as s, type Db } from "@job-search-os/db";
import {
  authResultsVerdict,
  classifyInbound,
  GMAIL_FORWARDING_PARSER,
  htmlToText,
  isExpectedSender,
  GMAIL_FORWARDING_SENDER,
  isPoolMailboxAddress,
  LINKEDIN_APPLICATION_PARSER,
  maskDigits,
  parseFromAddress,
  INBOUND_DMARC_MODES,
  readMode,
  readIntegerSetting,
  parsePoolMailbox,
  SECURITY_PARSER,
  type CriteriaRules,
  type InboundDmarcMode,
} from "@job-search-os/pipeline";
import { and, desc, eq, gt, gte, inArray, isNull, like, lt, not, or, sql } from "drizzle-orm";
import { applyLinkedinApplication } from "../applications/linkedin-application";
import { ingestBatch } from "../ingest/ingest-job";
import type { Logger } from "../logger";
import { enqueueEvaluationWith } from "../queue/pg-queue";
import { loadTaxonomy } from "../skills/sync";
import type { BlobStorage } from "../storage/blob";
import {
  chooseParserName,
  EMAIL_PARSERS,
  linkedinSenderKind,
  type EmailParser,
  type InboundEmailContent,
  type ParseResult,
} from "./parsers";
import { linkedinParser } from "./linkedin";
import { clampReason } from "./motivo";
import {
  isPoolAlertSender,
  POOL_MANUAL_QUEUE_REASON,
  POOL_OVERSIZE_REASON,
  POOL_PARSER,
  POOL_QUEUE_MAX_PER_DAY,
  POOL_QUEUE_MAX_PER_HOUR,
  POOL_RAW_MAX_BYTES,
  readPoolInboundConfig,
  type PoolInboundConfig,
} from "./pool-mailbox";
import {
  ResendReceivedEventSchema,
  type ReceivedEmailContent,
  type ResendReceivedEvent,
} from "./resend";

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
  /** Máximo de emails por usuario en 24 h. */
  dailyLimit?: number;
  /** Sin esto se lee de INBOUND_SIZE_MODE; por defecto `log`. */
  sizeMode?: InboundSizeMode;
  now?: () => Date;
  /** Casillas del pool (ADR-024). Sin esto se lee del entorno: apagado salvo POOL_SOURCE_COMPUTRABAJO_ALERTS=1. */
  pool?: PoolInboundConfig;
  /** Sin esto se lee de INBOUND_DMARC_MODE; por defecto `log`. */
  dmarcMode?: InboundDmarcMode;
  /**
   * Id del servidor que antepone `Authentication-Results` (INBOUND_AUTHSERV_ID). Sin esto, el veredicto es
   * `none`: en `enforce` el email se retiene. Una clave presente con `undefined` apaga la lectura del entorno.
   */
  authservId?: string | null;
  /** Tope de bytes de correo crudo por persona. Sin esto se lee de INBOUND_MAX_BYTES_PER_USER (200 MB). */
  maxBytesPerUser?: number;
  /** Solo `processHeldInbound`: la persona dueña pidió procesar este email aunque no esté verificado. */
  treatAsVerified?: boolean;
};

export type InboundOutcome =
  | { kind: "duplicate"; inboundId: string }
  | { kind: "pool_queued"; inboundId: string; career: string }
  | { kind: "unknown_recipient"; recipientsCount: number }
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

/** Remitente no esperado (JS-051): se guardó solo remitente, asunto y fecha. */
export const UNEXPECTED_SENDER_REASON =
  "remitente no esperado: por privacidad se guardó solo remitente, asunto y fecha, sin el cuerpo";

/** Email de seguridad (JS-119): código, acceso o contraseña, de cualquier remitente. */
export const SECURITY_EMAIL_REASON =
  "email de seguridad (código, acceso o contraseña): por privacidad se guardó solo remitente, asunto con los números enmascarados y fecha, sin el cuerpo";

/** Con INBOUND_DMARC_MODE=enforce: el cuerpo se guarda, pero el email no crea ofertas ni cambia estados. */
export const AUTH_UNVERIFIED_REASON = "remitente sin autenticación verificada: cola manual";

/** Valor de `inbound_emails.parser` para el ruido social de LinkedIn (JS-050). */
export const LINKEDIN_SOCIAL_PARSER = "linkedin_social";

/** `log`: un email sobre el tope medido se registra y se procesa. `enforce`: queda solo con metadatos. */
export type InboundSizeMode = "log" | "enforce";

/**
 * Tope medido. Por defecto solo se registra (`INBOUND_SIZE_MODE=log`) hasta conocer el tamaño de emails reales.
 */
export const USER_RAW_MAX_BYTES = 512 * 1024;
/** Por encima de esto el email nunca se lee ni se guarda completo, sea cual sea el modo. */
export const USER_RAW_HARD_MAX_BYTES = 2 * 1024 * 1024;
/** Largo máximo del asunto y del remitente que se guardan. */
export const MAX_STORED_HEADER_CHARS = 500;
export const OVERSIZE_EMAIL_REASON =
  "email demasiado grande: se guardó solo remitente, asunto y fecha, sin el cuerpo";

/** Tarjetas máximas por email. Las alertas reales traen unas pocas decenas. */
export const EMAIL_MAX_CARDS = 100;
export const TOO_MANY_CARDS_REASON = "el email trae demasiados avisos: cola manual";

const USER_DAILY_EMAIL_LIMIT = 300;

/** Fila provisional que cuenta el intento mientras el email se procesa. */
export const PENDING_RAW_REF = "pending:";
/** Una provisional con más de esto se considera abandonada: el reintento del mismo email la retoma. */
export const PENDING_RECLAIM_MS = 10 * 60_000;
/** Tope por defecto de correo crudo retenido por persona (beta). */
export const DEFAULT_MAX_BYTES_PER_USER = 200 * 1024 * 1024;
export const STORAGE_FULL_REASON =
  "almacenamiento de correo lleno: se guardó solo remitente, asunto y fecha, sin el cuerpo";
/** `raw_ref` de una fila sin crudo guardado (no es un `pg:`: la bandeja la muestra como vencida). */
const NO_RAW_REF = "none:";
export const PROCESSING_REASON = "procesando: el email no terminó de procesarse";
export const PROCESSING_UNEXPECTED_REASON =
  "procesando (remitente no esperado): el email no terminó de procesarse";
/** Lo que queda en una provisional que nadie retomó en una hora: pasa a la cola manual (la purga la barre). */
export const STALE_PROCESSING_REASON =
  "no terminó de procesarse y no llegó un reintento: cola manual";
export const STALE_PROCESSING_UNEXPECTED_REASON =
  "no terminó de procesarse y no llegó un reintento (remitente no esperado): cola manual";
export const OVERSIZE_UNEXPECTED_REASON =
  "email demasiado grande de un remitente no esperado: se guardó solo remitente, asunto y fecha, sin el cuerpo";

/**
 * Dos cupos separados por persona: remitentes esperados (portales de empleo, confirmación de Gmail) y
 * no esperados. Así un envío masivo desde una dirección cualquiera no deja sin cupo al correo real. El
 * cupo de cada uno es el de siempre (100 por hora, 300 por día). El motivo guardado en la fila decide a
 * cuál pertenece: no hace falta una columna nueva.
 */
const UNEXPECTED_BUCKET_REASONS: readonly string[] = [
  UNEXPECTED_SENDER_REASON,
  SECURITY_EMAIL_REASON,
  OVERSIZE_UNEXPECTED_REASON,
  PROCESSING_UNEXPECTED_REASON,
  STALE_PROCESSING_UNEXPECTED_REASON,
  // Lo que un From de portal no alcanza a demostrar: sin verificar, demasiado grande, sin parser o con
  // demasiadas tarjetas. Solo cuenta como esperado lo que el parser reconoció (ver `UNRECOGNIZED_PREFIX`).
  AUTH_UNVERIFIED_REASON,
  OVERSIZE_EMAIL_REASON,
  MANUAL_QUEUE_REASON,
  TOO_MANY_CARDS_REASON,
];
/** Los motivos «estructura no reconocida (parser): …» llevan texto variable: se agrupan por prefijo. */
const UNRECOGNIZED_PREFIX = "estructura no reconocida";
type QuotaBucket = "expected" | "unexpected";

type QuotaCheck = {
  limited: boolean;
  bucket: QuotaBucket;
  hour: number;
  day: number;
  /** Dominios que la persona marcó como fuente de empleo (se reusan al clasificar). */
  jobDomains: string[];
};

/**
 * Cupo de la persona para el remitente de este email, con lo que se sabe del evento (sin el cuerpo). Una
 * consulta de dominios y un conteo por el índice (user_id, received_at).
 */
async function checkUserQuota(
  db: Db,
  userId: string,
  from: string,
  now: Date,
  deps: Pick<InboundDeps, "hourlyLimit" | "dailyLimit">,
): Promise<QuotaCheck> {
  const domains = await db
    .select({ domain: s.inboundSenderDomains.domain })
    .from(s.inboundSenderDomains)
    .where(
      and(eq(s.inboundSenderDomains.userId, userId), eq(s.inboundSenderDomains.verdict, "empleo")),
    );
  const jobDomains = domains.map((d) => d.domain);
  // Por el remitente es lo único que se sabe antes de pedir el cuerpo; el cupo definitivo se decide
  // después de parsear (ver `bucketOfOutcome`)
  const bucket: QuotaBucket =
    isExpectedSender(from, jobDomains) || parseFromAddress(from) === GMAIL_FORWARDING_SENDER
      ? "expected"
      : "unexpected";
  const { hour, day } = await countBucket(db, userId, bucket, now);
  return {
    limited:
      hour >= (deps.hourlyLimit ?? 100) || day >= (deps.dailyLimit ?? USER_DAILY_EMAIL_LIMIT),
    bucket,
    hour,
    day,
    jobDomains,
  };
}

/** El motivo guardado de una fila lo manda al cupo de no esperados (NULL cuenta como esperado). */
const inUnexpectedBucket = () =>
  sql`(${inArray(s.inboundEmails.error, [...UNEXPECTED_BUCKET_REASONS])} or ${like(s.inboundEmails.error, `${UNRECOGNIZED_PREFIX}%`)})`;

/**
 * Cupo definitivo de un email ya procesado: lo ilegible, retenido o sin parser es de no esperados, salvo que
 * la autenticación del remitente haya salido verificada (`aligned`): un portal que cambió de formato no se
 * castiga.
 */
export function bucketOfOutcome(
  error: string | null,
  authVerdict: string | null = null,
): QuotaBucket {
  if (!error || authVerdict === "aligned") return "expected";
  return UNEXPECTED_BUCKET_REASONS.includes(error) || error.startsWith(UNRECOGNIZED_PREFIX)
    ? "unexpected"
    : "expected";
}

/**
 * Antes de pedir el cuerpo: un From de portal cuyo contenido ya salió ilegible cuenta contra el cupo de no
 * esperados mientras ese cupo esté lleno. Es lo único que se sabe sin leer el cuerpo: así el trabajo de
 * pedirlo y guardarlo no se repite. Se responde como cualquier rechazo por cupo (429): el remitente lo
 * reintenta cuando la ventana se libera. Una consulta de conteo y, solo con el cupo lleno, otra por el
 * índice (user_id, received_at).
 */
async function unreadableSenderOverQuota(
  db: Db,
  userId: string,
  from: string,
  now: Date,
  deps: Pick<InboundDeps, "hourlyLimit" | "dailyLimit">,
): Promise<QuotaCheck | null> {
  const counts = await countBucket(db, userId, "unexpected", now);
  if (
    counts.hour < (deps.hourlyLimit ?? 100) &&
    counts.day < (deps.dailyLimit ?? USER_DAILY_EMAIL_LIMIT)
  ) {
    return null;
  }
  const [row] = await db
    .select({ id: s.inboundEmails.id })
    .from(s.inboundEmails)
    .where(
      and(
        eq(s.inboundEmails.userId, userId),
        eq(s.inboundEmails.fromAddress, from.slice(0, MAX_STORED_HEADER_CHARS)),
        gte(s.inboundEmails.receivedAt, new Date(now.getTime() - 24 * 60 * 60 * 1000)),
        inUnexpectedBucket(),
      ),
    )
    .limit(1);
  return row ? { limited: true, bucket: "unexpected", ...counts, jobDomains: [] } : null;
}

/** Intentos de la última hora y del último día en un cupo, por el índice (user_id, received_at). */
async function countBucket(
  db: Db,
  userId: string,
  bucket: QuotaBucket,
  now: Date,
): Promise<{ hour: number; day: number }> {
  const inBucket =
    bucket === "unexpected"
      ? inUnexpectedBucket()
      : or(isNull(s.inboundEmails.error), not(inUnexpectedBucket()));
  const [counts] = (await db
    .select({
      hour: sql<number>`count(*) filter (where ${s.inboundEmails.receivedAt} >= ${new Date(now.getTime() - 60 * 60 * 1000).toISOString()}::timestamptz)::int`,
      day: sql<number>`count(*)::int`,
    })
    .from(s.inboundEmails)
    .where(
      and(
        eq(s.inboundEmails.userId, userId),
        gte(s.inboundEmails.receivedAt, new Date(now.getTime() - 24 * 60 * 60 * 1000)),
        inBucket,
      ),
    )) as { hour: number; day: number }[];
  return { hour: counts?.hour ?? 0, day: counts?.day ?? 0 };
}

/** El email no se guarda (es el punto del límite), pero queda contado para que /inbox avise (JS-038). */
async function rejectOverQuota(
  db: Db,
  userId: string,
  quota: QuotaCheck,
  now: Date,
  log: Pick<Logger, "warn">,
  /** Un reintento que retoma una provisional abandonada ya fue contado (o se perdió con la falla): no suma. */
  count = true,
): Promise<InboundOutcome> {
  log.warn(
    { user_id: userId, bucket: quota.bucket, count: quota.hour, day_count: quota.day },
    "inbound: rate limit por usuario",
  );
  if (count) await countRejection(db, userId, now);
  return { kind: "rate_limited", userId };
}

/** Una fila por usuario y hora: el contador que /inbox muestra como «rechazados». */
async function countRejection(db: Db, userId: string, now: Date): Promise<void> {
  await db.execute(sql`
    INSERT INTO inbound_rejections (user_id, window_start, rejected, last_at)
    VALUES (${userId}, date_trunc('hour', ${now.toISOString()}::timestamptz), 1, ${now.toISOString()}::timestamptz)
    ON CONFLICT (user_id, window_start)
    DO UPDATE SET rejected = inbound_rejections.rejected + 1, last_at = excluded.last_at
  `);
}

/** Bytes de correo crudo que ya retiene la persona: una suma por el índice (user_id, kind). */
export function userRawBytesSql(userId: string) {
  return sql`SELECT coalesce(sum(bytes), 0)::bigint AS bytes FROM raw_blobs WHERE user_id = ${userId}::uuid AND kind = 'inbound_email'`;
}

async function userRawBytes(db: Db, userId: string): Promise<number> {
  const rows = (await db.execute(userRawBytesSql(userId))) as unknown as {
    bytes: string | number;
  }[];
  return Number(rows[0]?.bytes ?? 0);
}

/**
 * Borra el crudo `ref` de la persona si ninguna fila de email ni oferta lo referencia. Un crudo que usa una
 * oferta (`job_sources.raw_ref`) no se toca. Un ref que no es `pg:<uuid>` se ignora.
 */
async function deleteRawIfUnreferenced(db: Db, userId: string, ref: string | null): Promise<void> {
  const id = ref?.startsWith("pg:") ? ref.slice(3) : null;
  if (!ref || !id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
    return;
  await db
    .execute(
      sql`
        DELETE FROM raw_blobs
        WHERE id = ${id}::uuid AND user_id = ${userId}::uuid AND kind = 'inbound_email'
          AND NOT EXISTS (SELECT 1 FROM inbound_emails e WHERE e.raw_ref = ${ref})
          AND NOT EXISTS (SELECT 1 FROM job_sources js WHERE js.raw_ref = ${ref})
      `,
    )
    .catch(() => undefined);
}

/** Los avisos de configuración salen una sola vez por proceso y por variable. */
const modeErrorsLogged = new Set<string>();

function logModeError(error: string | null, name: string, log: Pick<Logger, "error">): void {
  if (!error || modeErrorsLogged.has(name)) return;
  modeErrorsLogged.add(name);
  log.error({ variable: name }, error);
}

/** `INBOUND_SIZE_MODE`: `log` (por defecto) o `enforce`; mayúsculas y espacios no cuentan. */
export function readInboundSizeMode(
  raw: string | undefined,
  log: Pick<Logger, "error">,
): InboundSizeMode {
  const { value, error } = readMode("INBOUND_SIZE_MODE", raw, ["log", "enforce"] as const, "log");
  logModeError(error, "INBOUND_SIZE_MODE", log);
  return value;
}

/** `INBOUND_DMARC_MODE`: `off`, `log` (por defecto) o `enforce`. */
export function readInboundDmarcMode(
  raw: string | undefined,
  log: Pick<Logger, "error">,
): InboundDmarcMode {
  const { value, error } = readMode("INBOUND_DMARC_MODE", raw, INBOUND_DMARC_MODES, "log");
  logModeError(error, "INBOUND_DMARC_MODE", log);
  return value;
}

/** Dominio del remitente, con o sin nombre visible; null si no se puede leer. */
function senderDomain(from: string): string | null {
  const addr = parseFromAddress(from);
  return addr ? addr.slice(addr.lastIndexOf("@") + 1) : null;
}

/** Id de la fila ya guardada para ese email_id de Resend, o null. */
async function findByEmailId(db: Db, emailId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: s.inboundEmails.id })
    .from(s.inboundEmails)
    .where(eq(s.inboundEmails.emailId, emailId))
    .limit(1);
  return row?.id ?? null;
}

/**
 * Fila ya guardada para ese email_id y si es una provisional abandonada: sigue en `pending:` y pasó más de
 * `PENDING_RECLAIM_MS` desde que se creó. Una abandonada no es un duplicado: el reintento la retoma.
 */
async function findExisting(
  db: Db,
  emailId: string,
  now: Date,
): Promise<{ id: string; stale: boolean } | null> {
  const [row] = await db
    .select({
      id: s.inboundEmails.id,
      rawRef: s.inboundEmails.rawRef,
      receivedAt: s.inboundEmails.receivedAt,
    })
    .from(s.inboundEmails)
    .where(eq(s.inboundEmails.emailId, emailId))
    .limit(1);
  if (!row) return null;
  const stale =
    row.rawRef === PENDING_RAW_REF && row.receivedAt.getTime() < now.getTime() - PENDING_RECLAIM_MS;
  return { id: row.id, stale };
}

/**
 * Toma la fila provisional abandonada con un UPDATE atómico: solo gana el reintento que la ve todavía en
 * `pending:` y vieja; el que llega después la encuentra ya renovada y no devuelve fila.
 */
async function reclaimPending(
  db: Db,
  id: string,
  userId: string,
  now: Date,
): Promise<{ id: string } | null> {
  const [row] = await db
    .update(s.inboundEmails)
    .set({ receivedAt: now })
    .where(
      and(
        eq(s.inboundEmails.id, id),
        eq(s.inboundEmails.userId, userId),
        eq(s.inboundEmails.rawRef, PENDING_RAW_REF),
        lt(s.inboundEmails.receivedAt, new Date(now.getTime() - PENDING_RECLAIM_MS)),
      ),
    )
    .returning({ id: s.inboundEmails.id });
  return row ?? null;
}

/**
 * El índice único `inbound_emails_email_id` frenó el insert: otra entrega del mismo email llegó primero
 * (Svix reintentó mientras la primera seguía procesándose). Es un duplicado como cualquier otro: se
 * devuelve la fila ganadora. El crudo que esta entrega alcanzó a guardar no se borra: un aviso que ya
 * ingestó podría apuntarlo (`source.rawRef`) y quedaría colgando. Es un crudo de más, solo en esta carrera.
 */
async function duplicateAfterRace(
  db: Db,
  emailId: string,
  log: Pick<Logger, "warn">,
): Promise<InboundOutcome> {
  const winner = await findByEmailId(db, emailId);
  log.warn({}, "inbound: dos entregas del mismo email a la vez, gana la primera");
  if (!winner) throw new Error("inbound: el índice de email_id frenó el insert pero no hay fila");
  return { kind: "duplicate", inboundId: winner };
}

/** Las columnas de texto de Postgres no aceptan el carácter nulo: se saca antes de usar cada campo. */
const withoutNul = (text: string): string => text.replaceAll("\u0000", "");

/** Topes de entrada: un encabezado real mide una fracción de esto; lo de más se recorta antes de leerlo. */
const MAX_EVENT_FIELD_CHARS = 1_000;
const MAX_EVENT_RECIPIENTS = 100;
const MAX_EVENT_FROM_CHARS = 2_000;

const cleanField = (text: string, max = MAX_EVENT_FIELD_CHARS): string =>
  withoutNul(text.slice(0, max));
const cleanRecipients = (list: readonly string[]): string[] =>
  list.slice(0, MAX_EVENT_RECIPIENTS).map((r) => cleanField(r));

export function cleanEvent(event: ResendReceivedEvent): ResendReceivedEvent {
  const { data } = event;
  return {
    ...event,
    data: {
      ...data,
      email_id: cleanField(data.email_id),
      from: cleanField(data.from, MAX_EVENT_FROM_CHARS),
      to: cleanRecipients(data.to),
      cc: cleanRecipients(data.cc),
      bcc: cleanRecipients(data.bcc),
      received_for: cleanRecipients(data.received_for),
      ...(typeof data.subject === "string" ? { subject: cleanField(data.subject) } : {}),
      ...(data.message_id !== undefined ? { message_id: cleanField(data.message_id) } : {}),
    },
  };
}

function cleanContent(content: ReceivedEmailContent | null): ReceivedEmailContent | null {
  if (!content) return null;
  return {
    ...content,
    html: content.html === null ? null : withoutNul(content.html),
    text: content.text === null ? null : withoutNul(content.text),
  };
}

/** Un parser que lanza cuenta como estructura no reconocida: el email va a la cola manual. */
function parseOrManualQueue(
  parser: EmailParser,
  email: InboundEmailContent,
  log: Pick<Logger, "warn">,
): ParseResult {
  try {
    return parser.parse(email);
  } catch (e) {
    log.warn(
      { parser: parser.name, err_name: e instanceof Error ? e.name : "Error" },
      "inbound: el parser lanzó una excepción",
    );
    return { ok: false, reason: "no se pudo leer el contenido" };
  }
}

/** Direcciones del evento en minúsculas, en orden de prioridad: received_for, to, cc. */
export function eventRecipients(event: ResendReceivedEvent): string[] {
  return [...event.data.received_for, ...event.data.to, ...event.data.cc].map(recipientAddress);
}

/**
 * Dirección de un destinatario en minúsculas: lo que está entre el primer «<» y el primer «>» que lo sigue,
 * o el texto entero si no hay un par. Recorrido lineal (sin expresión regular): un destinatario hostil con
 * miles de «<» sin cerrar no encarece la lectura.
 */
export function recipientAddress(recipient: string): string {
  const open = recipient.indexOf("<");
  const close = open === -1 ? -1 : recipient.indexOf(">", open + 1);
  const inner = close > open + 1 ? recipient.slice(open + 1, close) : recipient;
  return inner.trim().toLowerCase();
}

/**
 * Perfiles cuya dirección actual está entre los destinatarios (en minúsculas). Solo si ninguna coincide se
 * busca la dirección anterior de una rotación, mientras dura la gracia: se guarda en minúsculas y tiene
 * índice único, así que ese segundo paso no recorre la tabla.
 */
async function matchProfiles(db: Db, recipients: string[], now: Date) {
  const columns = {
    userId: s.profiles.userId,
    inboundAddress: s.profiles.inboundAddress,
    previousInboundAddress: s.profiles.previousInboundAddress,
    previousInboundUntil: s.profiles.previousInboundUntil,
  };
  const current = await db
    .select(columns)
    .from(s.profiles)
    .where(sql`lower(${s.profiles.inboundAddress}) in ${recipients}`);
  if (current.length > 0) return current;
  return db
    .select(columns)
    .from(s.profiles)
    .where(
      and(
        inArray(s.profiles.previousInboundAddress, recipients),
        gt(s.profiles.previousInboundUntil, now),
      ),
    );
}

/**
 * ¿El email va a una persona (devuelve su id) o a una casilla del pool que lo aceptaría (`"pool"`)?
 * `null` si no va a ningún destino. Solo una consulta barata.
 */
async function inboundDestination(
  event: ResendReceivedEvent,
  deps: InboundDeps,
): Promise<string | "pool" | null> {
  const recipients = eventRecipients(event);
  if (recipients.length === 0) return null;
  const now = deps.now?.() ?? new Date();
  const [profile] = await matchProfiles(deps.db, recipients, now);
  if (profile) return profile.userId;
  const pool = deps.pool ?? readPoolInboundConfig();
  const poolAccepts =
    pool.enabled &&
    isPoolAlertSender(event.data.from, pool.senderDomains) &&
    recipients.filter(isPoolMailboxAddress).some((r) => parsePoolMailbox(r, pool).ok);
  return poolAccepts ? "pool" : null;
}

/**
 * Entrada del webhook: el cuerpo se pide a la API solo si el email es nuevo y tiene un destino válido.
 * Si pedirlo falla, la excepción sube sin guardar nada, para que el reintento lo procese completo.
 */
export async function processInboundEvent(
  receivedEvent: ResendReceivedEvent,
  rawBody: string,
  fetchContent: () => Promise<ReceivedEmailContent | null>,
  deps: InboundDeps,
): Promise<InboundOutcome> {
  const event = cleanEvent(receivedEvent);
  const now = deps.now?.() ?? new Date();
  const dup = await findExisting(deps.db, event.data.email_id, now);
  if (dup && !dup.stale) return { kind: "duplicate", inboundId: dup.id };
  const destination = await inboundDestination(event, deps);
  if (!destination) {
    const recipientsCount = eventRecipients(event).length;
    deps.logger.warn({ recipients_count: recipientsCount }, "inbound: destinatario sin usuario");
    return { kind: "unknown_recipient", recipientsCount };
  }
  if (destination !== "pool") {
    // Con el cupo agotado no se pide el cuerpo a Resend: alcanza con el remitente y el destinatario.
    // Una provisional abandonada ya está contada: retomarla no vuelve a pasar por el cupo.
    const quota = await checkUserQuota(deps.db, destination, event.data.from, now, deps);
    const log = deps.logger.child({ email_id: event.data.email_id });
    if (quota.limited && !dup) return rejectOverQuota(deps.db, destination, quota, now, log);
    // Un From de portal que ya dejó ilegibles con el cupo de no esperados lleno tampoco pide el cuerpo
    if (!dup && quota.bucket === "expected") {
      const unreadable = await unreadableSenderOverQuota(
        deps.db,
        destination,
        event.data.from,
        now,
        deps,
      );
      if (unreadable) return rejectOverQuota(deps.db, destination, unreadable, now, log);
    }
  }
  return handleInboundEmail(event, await fetchContent(), rawBody, deps);
}

export async function handleInboundEmail(
  receivedEvent: ResendReceivedEvent,
  receivedContent: ReceivedEmailContent | null,
  rawBody: string,
  deps: InboundDeps,
): Promise<InboundOutcome> {
  const event = cleanEvent(receivedEvent);
  const content = cleanContent(receivedContent);
  const { db } = deps;
  const now = deps.now?.() ?? new Date();
  const log = deps.logger.child({
    email_id: event.data.email_id,
    from_domain: senderDomain(event.data.from),
  });
  const dmarcMode = deps.dmarcMode ?? readInboundDmarcMode(process.env.INBOUND_DMARC_MODE, log);
  const authservId = "authservId" in deps ? deps.authservId : process.env.INBOUND_AUTHSERV_ID;
  const authVerdict =
    dmarcMode === "off" ? null : authResultsVerdict(content?.headers, authservId, event.data.from);
  // «Procesar igual» (la persona dueña lo pidió): se trata como verificado
  const authRequired =
    dmarcMode === "enforce" && authVerdict !== "aligned" && !deps.treatAsVerified;

  // Idempotencia (JS-115): Svix reintenta; el mismo email_id no se guarda dos veces. Se busca por la
  // columna `email_id` (índice único) y no dentro de los crudos. Si dos entregas del mismo email corren
  // a la vez y las dos pasan este chequeo, el índice deja entrar solo una: ver `claimedOrDuplicate`.
  const existing = await findExisting(db, event.data.email_id, now);
  if (existing && !existing.stale) return { kind: "duplicate", inboundId: existing.id };

  // Usuario por dirección de destino (u_<id>@ingest.<dominio>)
  const recipients = eventRecipients(event);
  const profiles = recipients.length ? await matchProfiles(db, recipients, now) : [];
  // Con varias direcciones del sistema, gana la primera por posición: received_for, to, cc. La dirección
  // anterior de una rotación cuenta mientras dure la gracia.
  const activePrevious = (p: (typeof profiles)[number]): string | null =>
    p.previousInboundAddress && p.previousInboundUntil && p.previousInboundUntil > now
      ? p.previousInboundAddress.toLowerCase()
      : null;
  const byAddress = new Map(
    profiles.flatMap((p) => {
      const previous = activePrevious(p);
      return [
        [p.inboundAddress?.toLowerCase(), p] as const,
        ...(previous ? [[previous, p] as const] : []),
      ];
    }),
  );

  // ADR-024: las casillas pool-* son entrada del pool, no de una persona. Se decide por el sobre
  // (received_for) cuando existe; si entre esos destinatarios hay una dirección u_… válida, gana
  // el flujo normal y el email no se desvía al pool. Apagado, ajena o inválida: se rechaza como un
  // destinatario desconocido.
  // `recipients` ya viene calculada una sola vez: received_for, to, cc, en ese orden
  const receivedForCount = event.data.received_for.length;
  const envelope = recipients.slice(0, receivedForCount);
  const basis = envelope.length ? envelope : recipients;
  if (!basis.some((r) => byAddress.has(r)) && basis.some(isPoolMailboxAddress)) {
    const pool = deps.pool ?? readPoolInboundConfig();
    const mailbox = basis
      .filter(isPoolMailboxAddress)
      .map((r) => parsePoolMailbox(r, pool))
      .find((m) => m.ok);
    if (
      !pool.enabled ||
      !mailbox?.ok ||
      !isPoolAlertSender(event.data.from, pool.senderDomains) ||
      authRequired
    ) {
      log.warn(
        { recipients_count: recipients.length, pool_enabled: pool.enabled },
        "inbound: casilla del pool rechazada",
      );
      return { kind: "unknown_recipient", recipientsCount: recipients.length };
    }
    // Tope de la cola del pool: el From se falsifica fácil, así que se limita el volumen
    const [counts] = (await db
      .select({
        hour: sql<number>`count(*) filter (where ${s.inboundEmails.receivedAt} >= ${new Date(now.getTime() - 60 * 60 * 1000).toISOString()}::timestamptz)::int`,
        day: sql<number>`count(*)::int`,
      })
      .from(s.inboundEmails)
      .where(
        and(
          isNull(s.inboundEmails.userId),
          eq(s.inboundEmails.parser, POOL_PARSER),
          gte(s.inboundEmails.receivedAt, new Date(now.getTime() - 24 * 60 * 60 * 1000)),
        ),
      )) as { hour: number; day: number }[];
    if (
      (counts?.hour ?? 0) >= POOL_QUEUE_MAX_PER_HOUR ||
      (counts?.day ?? 0) >= POOL_QUEUE_MAX_PER_DAY
    ) {
      log.warn(
        { pool_last_hour: counts?.hour ?? 0, pool_last_day: counts?.day ?? 0 },
        "inbound: cola del pool llena, rechazado",
      );
      return { kind: "unknown_recipient", recipientsCount: recipients.length };
    }
    // Sin lector validado todo va a la cola manual del pool (ADR-024 §9): fila sin usuario, con el
    // crudo completo (remitente esperado) y marcada con el parser del pool. Nunca se extrae nada.
    // Si el crudo pasa el tope de tamaño, solo metadatos (como JS-051).
    const full = JSON.stringify({
      event: JSON.parse(rawBody),
      content,
      pool_career: mailbox.career,
    });
    const oversize = Buffer.byteLength(full, "utf8") > POOL_RAW_MAX_BYTES;
    const rawRef = await deps.storage.put({
      userId: null,
      kind: "inbound_email",
      contentType: "application/json",
      body: oversize
        ? JSON.stringify({
            event: {
              type: event.type,
              created_at: event.created_at,
              data: {
                email_id: event.data.email_id,
                from: event.data.from,
                to: event.data.to,
                received_for: event.data.received_for,
                subject: event.data.subject ? maskDigits(event.data.subject) : null,
              },
            },
            content: null,
            pool_career: mailbox.career,
            redacted: POOL_OVERSIZE_REASON,
          })
        : full,
    });
    const [row] = await db
      .insert(s.inboundEmails)
      .values({
        userId: null,
        emailId: event.data.email_id,
        fromAddress: event.data.from,
        subject: event.data.subject ? maskDigits(event.data.subject) : null,
        rawRef,
        parser: POOL_PARSER,
        jobsExtracted: 0,
        error: oversize ? POOL_OVERSIZE_REASON : POOL_MANUAL_QUEUE_REASON,
        receivedAt: now,
      })
      .onConflictDoNothing({ target: s.inboundEmails.emailId })
      .returning({ id: s.inboundEmails.id });
    if (!row) return duplicateAfterRace(db, event.data.email_id, log);
    log.info({ career: mailbox.career, oversize }, "inbound: casilla del pool a la cola manual");
    return { kind: "pool_queued", inboundId: row.id, career: mailbox.career };
  }

  const profile = recipients.map((r) => byAddress.get(r)).find((p) => p !== undefined);
  if (!profile) {
    // Solo la cantidad: las direcciones son secretos de usuarios y la respuesta del webhook sale
    // hacia afuera (JS-095)
    log.warn({ recipients_count: recipients.length }, "inbound: destinatario sin usuario");
    return { kind: "unknown_recipient", recipientsCount: recipients.length };
  }
  const userId = profile.userId;
  // `enforce` sin servidor de autenticación: ningún email queda verificado y los de portales se retienen
  if (dmarcMode === "enforce" && !authservId?.trim()) {
    logModeError(
      "INBOUND_DMARC_MODE está en «enforce» pero falta INBOUND_AUTHSERV_ID: los emails de portales quedan retenidos",
      "INBOUND_AUTHSERV_ID",
      log.child({ user_id: userId }),
    );
  }

  const quota = await checkUserQuota(db, userId, event.data.from, now, deps);
  // Una provisional abandonada ya está contada: retomarla no vuelve a pasar por el cupo
  if (quota.limited && !existing) return rejectOverQuota(db, userId, quota, now, log);
  const { jobDomains, bucket } = quota;

  // El intento se cuenta antes de leer el contenido: una fila provisional ocupa cupo y marca el
  // email_id como visto. Si el procesamiento queda colgado y la función muere, el reintento posterior a
  // PENDING_RECLAIM_MS la retoma (UPDATE atómico, gana uno solo) y antes de eso es un duplicado; si falla
  // con una excepción, se borra para que el reintento lo procese.
  let claim: { id: string } | null | undefined;
  if (existing) {
    claim = await reclaimPending(db, existing.id, userId, now);
    if (!claim) return { kind: "duplicate", inboundId: existing.id };
    log.warn({ user_id: userId }, "inbound: se retoma una fila provisional abandonada");
  } else {
    [claim] = await db
      .insert(s.inboundEmails)
      .values({
        userId,
        emailId: event.data.email_id,
        fromAddress: event.data.from.slice(0, MAX_STORED_HEADER_CHARS),
        rawRef: PENDING_RAW_REF,
        parser: "none",
        jobsExtracted: 0,
        error: bucket === "expected" ? PROCESSING_REASON : PROCESSING_UNEXPECTED_REASON,
        receivedAt: now,
      })
      .onConflictDoNothing({ target: s.inboundEmails.emailId })
      .returning({ id: s.inboundEmails.id });
    if (!claim) return duplicateAfterRace(db, event.data.email_id, log);
  }
  const claimId = claim.id;
  let ownRawRef: string | null = null;

  try {
    // Un email que pasa el tope no se lee: queda solo con metadatos, como uno de remitente no esperado.
    const emailBytes =
      Buffer.byteLength(rawBody, "utf8") +
      Buffer.byteLength(content?.html ?? "", "utf8") +
      Buffer.byteLength(content?.text ?? "", "utf8");
    const sizeMode = deps.sizeMode ?? readInboundSizeMode(process.env.INBOUND_SIZE_MODE, log);
    const overMeasuredLimit = emailBytes > USER_RAW_MAX_BYTES;
    const oversize =
      emailBytes > USER_RAW_HARD_MAX_BYTES || (overMeasuredLimit && sizeMode === "enforce");
    if (overMeasuredLimit) {
      log.warn(
        { user_id: userId, bytes: emailBytes, size_mode: sizeMode },
        "inbound: email grande",
      );
    }

    // Tope de correo crudo por persona: pasado el tope no se guarda el crudo, pero la fila queda visible
    // con su motivo y se cuenta como rechazado. Un valor mal escrito cae al tope por defecto.
    const maxBytesSetting = readIntegerSetting(
      "INBOUND_MAX_BYTES_PER_USER",
      process.env.INBOUND_MAX_BYTES_PER_USER,
      1_000_000,
      100 * 1024 * 1024 * 1024,
    );
    logModeError(maxBytesSetting.error, "INBOUND_MAX_BYTES_PER_USER", log);
    const maxBytes = deps.maxBytesPerUser ?? maxBytesSetting.value ?? DEFAULT_MAX_BYTES_PER_USER;
    const usedBytes = await userRawBytes(db, userId);
    const storageFull = usedBytes + (oversize ? 0 : emailBytes) > maxBytes;
    if (storageFull) {
      log.warn(
        { user_id: userId, used_bytes: usedBytes, bytes: emailBytes, max_bytes: maxBytes },
        "inbound: tope de almacenamiento de correo, no se guarda el crudo",
      );
      // La fila se guarda con su motivo y las ofertas entran: no es un rechazo, no suma al contador
    }

    // JS-119: se clasifica antes del chequeo de remitente. Los códigos y reseteos (de cualquier
    // remitente) se guardan como los de un remitente no esperado y con el asunto enmascarado;
    // la confirmación de reenvío de Gmail dirigida a esta dirección se guarda completa.
    // Remitente esperado (fuente de empleo, JS-051): ahí `seguridad` se decide solo por el asunto.
    // Sin parte de texto se clasifica con el HTML pasado a texto.
    const senderExpected = isExpectedSender(event.data.from, jobDomains);
    const classification = classifyInbound({
      from: event.data.from,
      to: recipients,
      subject: event.data.subject,
      text: oversize ? null : content?.text || (content?.html ? htmlToText(content.html) : null),
      securityBySubjectOnly: senderExpected,
    });
    const category = classification.category;
    const ownAddresses = [profile.inboundAddress?.toLowerCase(), activePrevious(profile)].filter(
      (a): a is string => typeof a === "string",
    );
    // received_for y to son los primeros destinatarios de `recipients` (cc va al final)
    const addressedToUser = recipients
      .slice(0, receivedForCount + event.data.to.length)
      .some((r) => ownAddresses.includes(r));
    const isSecurity = category === "seguridad";
    const gmailConfirmClaimed = category === "confirmacion_reenvio_gmail" && addressedToUser;
    // En `enforce`, un remitente esperado sin autenticación verificada se guarda pero no se procesa
    const authHold = authRequired && (senderExpected || gmailConfirmClaimed);
    const isGmailConfirm = gmailConfirmClaimed && !authHold;

    // JS-051: red de seguridad de privacidad. Si el reenvío de Gmail manda correo personal (banco,
    // códigos, resets de contraseña), no se guarda su contenido: completo solo lo de remitentes
    // esperados (fuentes de empleo conocidas o dominios marcados como fuente de empleo). Del resto,
    // solo remitente, destinatarios, asunto, fecha y el email_id (idempotencia); ni cuerpo ni
    // nombres de adjuntos.
    const expected = !isSecurity && !oversize && (gmailConfirmClaimed || senderExpected);
    const authRecord = authVerdict ? { auth_verdict: authVerdict } : {};
    // Todo lo que no se guarda completo lleva el asunto con los números enmascarados
    const headerSubject = event.data.subject?.slice(0, MAX_STORED_HEADER_CHARS) ?? null;
    const storedFrom = event.data.from.slice(0, MAX_STORED_HEADER_CHARS);
    const storedSubject = expected
      ? headerSubject
      : headerSubject
        ? maskDigits(headerSubject)
        : null;
    const rawRef = storageFull
      ? NO_RAW_REF
      : await deps.storage.put({
          userId,
          kind: "inbound_email",
          contentType: "application/json",
          body: JSON.stringify(
            expected
              ? { event: JSON.parse(rawBody), content, ...authRecord }
              : {
                  event: {
                    type: event.type,
                    created_at: event.created_at,
                    data: {
                      email_id: event.data.email_id,
                      from: storedFrom,
                      to: event.data.to,
                      received_for: event.data.received_for,
                      subject: storedSubject,
                    },
                  },
                  content: null,
                  redacted: isSecurity
                    ? SECURITY_EMAIL_REASON
                    : oversize
                      ? OVERSIZE_EMAIL_REASON
                      : UNEXPECTED_SENDER_REASON,
                  ...authRecord,
                },
          ),
        });

    if (!storageFull) ownRawRef = rawRef;

    const parserName = chooseParserName(event.data.from);
    const parser = EMAIL_PARSERS[parserName];
    let jobsExtracted = 0;
    let error: string | null = null;
    let parserUsed: string | null = null;
    let dismissedAt: Date | null = null;
    let seen = false;

    // Con el tope pasado el email se procesa igual (sus ofertas entran): el cuerpo vive en memoria y solo
    // se omite guardar el crudo
    if (isSecurity) {
      parserUsed = SECURITY_PARSER;
      error = SECURITY_EMAIL_REASON;
      dismissedAt = now;
    } else if (oversize) {
      error = bucket === "expected" ? OVERSIZE_EMAIL_REASON : OVERSIZE_UNEXPECTED_REASON;
    } else if (authHold) {
      error = AUTH_UNVERIFIED_REASON;
    } else if (isGmailConfirm) {
      // Queda completo y pendiente: la persona tiene que abrir el link de confirmación
      parserUsed = GMAIL_FORWARDING_PARSER;
    } else if (!expected) {
      error = UNEXPECTED_SENDER_REASON;
    } else if (
      (category === "postulacion_enviada" || category === "postulacion_vista") &&
      classification.application
    ) {
      parserUsed = LINKEDIN_APPLICATION_PARSER;
      seen = true;
      const result = await applyLinkedinApplication(
        db,
        userId,
        category === "postulacion_enviada" ? "enviada" : "vista",
        classification.application,
        now,
      );
      log.info(
        { user_id: userId, match: result.match, action: result.action },
        "inbound: postulacion de LinkedIn",
      );
    } else if (linkedinSenderKind(event.data.from) === "social") {
      // JS-050: ruido social de LinkedIn. Se guarda (con su crudo) ya descartado, así no ensucia
      // Pendientes ni la cola manual y se puede revisar. Si trae tarjetas de aviso, LinkedIn cambió
      // el formato: no se ingesta ni se descarta, queda en Pendientes para revisar la regla.
      parserUsed = LINKEDIN_SOCIAL_PARSER;
      const cards = content?.html
        ? parseOrManualQueue(
            linkedinParser,
            {
              from: event.data.from,
              to: recipients,
              subject: event.data.subject ?? null,
              html: content.html,
              text: content.text,
              receivedAt: now,
            },
            log,
          )
        : null;
      if (cards?.ok && cards.jobs.length) {
        error = `notificación social de LinkedIn con ${cards.jobs.length} tarjetas de aviso: revisar la regla de remitentes (no se cargaron)`;
      } else {
        dismissedAt = now;
      }
    } else if (!parser) {
      error = MANUAL_QUEUE_REASON;
    } else if (!content) {
      error =
        "sin cuerpo del email (no se configuró RESEND_API_KEY o el correo ya no está disponible en Resend): cola manual";
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
      const parsed = parseOrManualQueue(parser, email, log);
      if (!parsed.ok) {
        error = `estructura no reconocida (${parser.name}): ${clampReason(parsed.reason)}. Cola manual`;
      } else if (parsed.jobs.length > EMAIL_MAX_CARDS) {
        error = TOO_MANY_CARDS_REASON;
      } else if (parsed.jobs.length) {
        const [criteria] = await db
          .select({ rules: s.evaluationCriteria.rules })
          .from(s.evaluationCriteria)
          .where(
            and(eq(s.evaluationCriteria.userId, userId), eq(s.evaluationCriteria.active, true)),
          )
          .orderBy(desc(s.evaluationCriteria.version))
          .limit(1);
        if (!criteria) {
          error = "usuario sin criterios activos";
        } else {
          // Cada aviso extraído apunta al crudo del email (JS-024)
          // (sin crudo guardado no hay a qué apuntar)
          const jobs = parsed.jobs.map((j) => ({
            ...j,
            source: storageFull ? j.source : { ...j.source, rawRef },
          }));
          const summary = await ingestBatch(jobs, {
            db,
            userId,
            rules: criteria.rules as CriteriaRules,
            logger: log,
            enqueueEvaluation: enqueueEvaluationWith(db),
            now: () => now,
            taxonomy: await loadTaxonomy(db),
          });
          jobsExtracted = summary.inserted + summary.merged;
          if (summary.errors.length)
            error = `${summary.errors.length} avisos con error al ingestar`;
        }
      }
    }

    // Cupo definitivo: un email que dijo venir de un portal pero resultó ilegible, retenido o sin parser
    // es de no esperados. Si ese cupo está lleno, no se guarda (como cualquier rechazo por cupo) y el
    // cupo esperado queda para lo que el parser reconoció.
    if (bucket === "expected" && bucketOfOutcome(error, authVerdict) === "unexpected") {
      const counts = await countBucket(db, userId, "unexpected", now);
      if (
        counts.hour >= (deps.hourlyLimit ?? 100) ||
        counts.day >= (deps.dailyLimit ?? USER_DAILY_EMAIL_LIMIT)
      ) {
        await db.delete(s.inboundEmails).where(eq(s.inboundEmails.id, claimId));
        await deleteRawIfUnreferenced(db, userId, ownRawRef);
        return rejectOverQuota(
          db,
          userId,
          { limited: true, bucket: "unexpected", ...counts, jobDomains },
          now,
          log,
          !existing,
        );
      }
    }

    // Resuelto solo (postulación de LinkedIn) o con avisos extraídos y sin error: no necesita a
    // la persona. Un fallo parcial ("N avisos con error") queda en Pendientes.
    const resolved = seen || (jobsExtracted > 0 && error === null);
    // Sin crudo guardado por el tope, la fila lo dice (si no hay otro motivo más útil)
    if (storageFull && error === null) error = STORAGE_FULL_REASON;

    const [row] = await db
      .update(s.inboundEmails)
      .set({
        fromAddress: storedFrom,
        subject: storedSubject,
        rawRef,
        parser: parserUsed ?? (parser ? parserName : "none"),
        jobsExtracted,
        error,
        seenAt: resolved ? now : null,
        dismissedAt,
      })
      .where(eq(s.inboundEmails.id, claimId))
      .returning({ id: s.inboundEmails.id });
    if (!row) throw new Error("inbound: la fila provisional desapareció antes de terminar");
    // Nunca el asunto ni el cuerpo: pueden traer códigos
    log.info(
      {
        user_id: userId,
        category,
        auth_verdict: authVerdict,
        parser: parserUsed,
        jobs_extracted: jobsExtracted,
        error,
      },
      "inbound: guardado",
    );
    return {
      kind: "stored",
      inboundId: row.id,
      userId,
      parser: parserUsed,
      jobsExtracted,
      error,
    };
  } catch (e) {
    // Falló con una excepción: la provisional no se borra (si el reintento de Svix ya la vio como duplicado,
    // borrarla perdería el email). Queda en `pending:` con la fecha vencida para que el próximo reintento
    // la retome o el barrido la mande a la cola manual. Sigue siendo una sola fila: el cupo no cuenta doble.
    // Si ya se terminó de guardar (la falla fue después), no se toca. «Procesar igual» sí la borra: la fila
    // retenida necesita recuperar su email_id.
    if (deps.treatAsVerified) {
      await db
        .delete(s.inboundEmails)
        .where(eq(s.inboundEmails.id, claimId))
        .catch(() => undefined);
    } else {
      await db
        .update(s.inboundEmails)
        .set({ receivedAt: new Date(now.getTime() - PENDING_RECLAIM_MS - 1_000) })
        .where(and(eq(s.inboundEmails.id, claimId), eq(s.inboundEmails.rawRef, PENDING_RAW_REF)))
        .catch(() => undefined);
    }
    // El crudo de esta entrega fallida no queda colgado si ninguna fila ni oferta lo usa
    await deleteRawIfUnreferenced(db, userId, ownRawRef);
    throw e;
  }
}

export type HeldInboundResult = { ok: true; inboundId: string } | { ok: false; reason: string };

/**
 * «Procesar igual» (INBOUND_DMARC_MODE=enforce): vuelve a procesar un email retenido por falta de
 * autenticación, como si estuviera verificado. Solo el de la persona dueña (`userId`) y solo si el motivo
 * es el de «no verificado». La fila retenida cede su `email_id` mientras se procesa y se borra solo si el
 * resultado queda guardado: ante cualquier otra salida (cupo, duplicado, excepción) vuelve a quedar como estaba.
 */
export async function processHeldInbound(
  inboundId: string,
  userId: string,
  deps: InboundDeps,
): Promise<HeldInboundResult> {
  const { db } = deps;
  const [held] = await db
    .select({
      id: s.inboundEmails.id,
      rawRef: s.inboundEmails.rawRef,
      emailId: s.inboundEmails.emailId,
    })
    .from(s.inboundEmails)
    .where(
      and(
        eq(s.inboundEmails.id, inboundId),
        eq(s.inboundEmails.userId, userId),
        eq(s.inboundEmails.error, AUTH_UNVERIFIED_REASON),
      ),
    )
    .limit(1);
  if (!held?.emailId) return { ok: false, reason: "el email no está retenido" };

  const blob = await deps.storage.get(held.rawRef);
  let stored: { event?: unknown; content?: ReceivedEmailContent | null };
  try {
    stored = JSON.parse(blob?.body ?? "");
  } catch {
    return { ok: false, reason: "no se pudo leer el contenido guardado" };
  }
  const event = ResendReceivedEventSchema.safeParse(stored.event);
  if (!event.success || !stored.content) {
    return { ok: false, reason: "no se pudo leer el contenido guardado" };
  }

  const holdKey = `held:${held.id}`;
  await db.update(s.inboundEmails).set({ emailId: holdKey }).where(eq(s.inboundEmails.id, held.id));
  const restore = () =>
    db
      .update(s.inboundEmails)
      .set({ emailId: held.emailId })
      .where(eq(s.inboundEmails.id, held.id))
      .catch(() => undefined);
  try {
    const out = await handleInboundEmail(event.data, stored.content, JSON.stringify(stored.event), {
      ...deps,
      treatAsVerified: true,
    });
    if (out.kind !== "stored" || out.userId !== userId) {
      await restore();
      return { ok: false, reason: "no se pudo procesar ahora" };
    }
    await db.delete(s.inboundEmails).where(eq(s.inboundEmails.id, held.id));
    // El crudo retenido ya no lo usa nadie: el procesamiento guardó el suyo
    await deleteRawIfUnreferenced(db, userId, held.rawRef);
    return { ok: true, inboundId: out.inboundId };
  } catch (e) {
    await restore();
    throw e;
  }
}
