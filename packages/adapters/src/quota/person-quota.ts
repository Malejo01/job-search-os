import { schema as s, type Db } from "@job-search-os/db";
import {
  checkPersonQuota,
  DEFAULT_PERSON_QUOTA_LIMITS,
  MAX_MANUAL_JOBS_PER_PERSON,
  MAX_RAW_BYTES_PER_PERSON,
  type PersonQuotaAdd,
  type PersonQuotaLimits,
} from "@job-search-os/pipeline";
import { and, eq, sql } from "drizzle-orm";

/** Namespace del lock por persona de las cuotas (los otros locks por persona usan el suyo). */
export const PERSON_QUOTA_LOCK_NAMESPACE = 7107;

const ANSWER_QUOTA_MESSAGE =
  "llegaste al máximo de respuestas guardadas: borrá alguna que ya no uses o acortá las más largas";

export class PersonQuotaError extends Error {
  /** `answers`: banco de respuestas y formularios respondidos (el MCP lo informa como `cuota_respuestas`). */
  readonly kind: "manual_jobs" | "raw_bytes" | "answers";
  constructor(kind: "manual_jobs" | "raw_bytes" | "answers", message?: string) {
    super(
      message ??
        (kind === "manual_jobs"
          ? `llegaste al máximo de ${MAX_MANUAL_JOBS_PER_PERSON} ofertas cargadas a mano`
          : kind === "answers"
            ? ANSWER_QUOTA_MESSAGE
            : `llegaste al máximo de espacio para avisos guardados (${Math.round(MAX_RAW_BYTES_PER_PERSON / 1024 / 1024)} MB)`),
    );
    this.name = "PersonQuotaError";
    this.kind = kind;
  }
}

/**
 * Crudos de correo: llegan solos, no los carga la persona. No cuentan en su cuota de espacio, que existe para
 * lo que ella pega o sube (JD pegadas, ofertas a mano, imágenes). `inbound_email` es el email entero;
 * `ingest_email_*` el crudo de cada aviso que sale de un correo.
 */
const isEmailBlob = sql`(${s.rawBlobs.kind} = 'inbound_email' or ${s.rawBlobs.kind} like 'ingest\\_email\\_%')`;

/** Bytes de `raw_blobs` que cargó la persona (sin los crudos de correo). Sin ejecutar. */
export function personRawBytesQuery(db: Pick<Db, "select">, userId: string) {
  return db
    .select({ n: sql<number>`coalesce(sum(${s.rawBlobs.bytes}), 0)::float8` })
    .from(s.rawBlobs)
    .where(and(eq(s.rawBlobs.userId, userId), sql`not ${isEmailBlob}`));
}

/** Topes de las respuestas guardadas por persona (filas y bytes de pregunta + respuesta). */
export type AnswerQuotaLimits = {
  /** `answer_bank`: respuestas reutilizables. */
  bankRows: number;
  bankBytes: number;
  /** `application_answers`: formularios respondidos, de todas las ofertas. */
  formRows: number;
  formBytes: number;
};

export const DEFAULT_ANSWER_QUOTA_LIMITS: AnswerQuotaLimits = {
  bankRows: 500,
  bankBytes: 2 * 1024 * 1024,
  formRows: 3_000,
  formBytes: 5 * 1024 * 1024,
};

/**
 * Topes desde ANSWER_BANK_MAX_ROWS, ANSWER_BANK_MAX_BYTES, APPLICATION_ANSWERS_MAX_ROWS y
 * APPLICATION_ANSWERS_MAX_BYTES. Vacío o inválido (no entero ≥ 1) usa el valor por defecto.
 */
export function answerQuotaLimitsFromEnv(env: NodeJS.ProcessEnv = process.env): AnswerQuotaLimits {
  const pick = (name: string, fallback: number): number => {
    const raw = env[name]?.trim();
    if (!raw || !/^\d+$/.test(raw)) return fallback;
    const n = Number(raw);
    return Number.isSafeInteger(n) && n >= 1 ? n : fallback;
  };
  const d = DEFAULT_ANSWER_QUOTA_LIMITS;
  return {
    bankRows: pick("ANSWER_BANK_MAX_ROWS", d.bankRows),
    bankBytes: pick("ANSWER_BANK_MAX_BYTES", d.bankBytes),
    formRows: pick("APPLICATION_ANSWERS_MAX_ROWS", d.formRows),
    formBytes: pick("APPLICATION_ANSWERS_MAX_BYTES", d.formBytes),
  };
}

/** Bytes (UTF-8) de una pregunta con su respuesta. */
export const answerBytes = (question: string, answer: string): number =>
  Buffer.byteLength(question, "utf8") + Buffer.byteLength(answer, "utf8");

/** Filas y bytes de `answer_bank` de la persona. Entra por el índice único que empieza por `user_id`. */
export function answerBankUsageQuery(db: Pick<Db, "select">, userId: string) {
  return db
    .select({
      rows: sql<number>`count(*)::int`,
      bytes: sql<number>`coalesce(sum(octet_length(${s.answerBank.question}) + octet_length(${s.answerBank.answer})), 0)::float8`,
    })
    .from(s.answerBank)
    .where(eq(s.answerBank.userId, userId));
}

/**
 * Filas y bytes de `application_answers` de la persona, sin contar la oferta `exceptJobId` (que se
 * reemplaza entera). Entra por `jobs` (índice por `user_id`) y por el índice único que empieza por `job_id`.
 */
export function applicationAnswersUsageQuery(
  db: Pick<Db, "select">,
  userId: string,
  exceptJobId: string,
) {
  return db
    .select({
      rows: sql<number>`count(*)::int`,
      bytes: sql<number>`coalesce(sum(octet_length(${s.applicationAnswers.question}) + octet_length(${s.applicationAnswers.answer})), 0)::float8`,
    })
    .from(s.applicationAnswers)
    .innerJoin(s.jobs, eq(s.jobs.id, s.applicationAnswers.jobId))
    .where(and(eq(s.jobs.userId, userId), sql`${s.jobs.id} <> ${exceptJobId}`));
}

const takeQuotaLock = (db: Pick<Db, "execute">, userId: string) =>
  db.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${userId}, ${PERSON_QUOTA_LOCK_NAMESPACE}))`,
  );

/**
 * Cuota de `answer_bank` bajo el mismo lock por persona que la de espacio. `add` es lo que suma esta
 * escritura: una respuesta nueva suma una fila y sus bytes; reemplazar una existente suma 0 filas y la
 * diferencia de bytes (si crece). Falla con `PersonQuotaError` de tipo `answers` (`cuota_respuestas` en el MCP).
 */
export async function reserveAnswerBankQuota(
  db: Db,
  userId: string,
  add: { rows: number; bytes: number },
  limits: AnswerQuotaLimits = answerQuotaLimitsFromEnv(),
): Promise<void> {
  await takeQuotaLock(db, userId);
  const [usage] = await answerBankUsageQuery(db, userId);
  if (
    (add.rows > 0 && Number(usage?.rows ?? 0) + add.rows > limits.bankRows) ||
    (add.bytes > 0 && Number(usage?.bytes ?? 0) + add.bytes > limits.bankBytes)
  ) {
    throw new PersonQuotaError("answers");
  }
}

/** Igual para `application_answers`: `add` es el formulario nuevo completo; el anterior de esa oferta se descarta. */
export async function reserveApplicationAnswersQuota(
  db: Db,
  userId: string,
  jobId: string,
  add: { rows: number; bytes: number },
  limits: AnswerQuotaLimits = answerQuotaLimitsFromEnv(),
): Promise<void> {
  await takeQuotaLock(db, userId);
  const [usage] = await applicationAnswersUsageQuery(db, userId, jobId);
  if (
    Number(usage?.rows ?? 0) + add.rows > limits.formRows ||
    Number(usage?.bytes ?? 0) + add.bytes > limits.formBytes
  ) {
    throw new PersonQuotaError("answers");
  }
}

/**
 * Decide la cuota de la persona dentro de la transacción del llamador: toma un lock por persona
 * que dura hasta el commit, mide lo que ya hay (ofertas manuales y bytes de `raw_blobs`) y falla
 * con `PersonQuotaError` si lo nuevo no entra (los crudos de correo no cuentan). Con el lock, dos pedidos en paralelo no pasan los
 * dos por el mismo hueco. `db` tiene que ser la transacción (con `app.user_id` puesto: la RLS
 * limita el conteo a la persona); fuera de una transacción el lock se suelta al terminar la sentencia.
 */
export async function reservePersonQuota(
  db: Db,
  userId: string,
  add: PersonQuotaAdd,
  /** Solo para pruebas: topes más chicos que los reales. */
  limits: PersonQuotaLimits = DEFAULT_PERSON_QUOTA_LIMITS,
): Promise<void> {
  await takeQuotaLock(db, userId);
  const [jobs] = await db
    .select({ n: sql<number>`count(distinct ${s.jobSources.jobId})::int` })
    .from(s.jobSources)
    .innerJoin(s.jobs, eq(s.jobs.id, s.jobSources.jobId))
    .where(
      and(
        eq(s.jobs.userId, userId),
        eq(s.jobSources.kind, "manual"),
        eq(s.jobSources.sourceName, "manual"),
      ),
    );
  const [blobs] = await personRawBytesQuery(db, userId);
  const verdict = checkPersonQuota(
    { manualJobs: Number(jobs?.n ?? 0), rawBytes: Number(blobs?.n ?? 0) },
    add,
    limits,
  );
  if (!verdict.ok) throw new PersonQuotaError(verdict.kind);
}
