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

export class PersonQuotaError extends Error {
  readonly kind: "manual_jobs" | "raw_bytes";
  constructor(kind: "manual_jobs" | "raw_bytes") {
    super(
      kind === "manual_jobs"
        ? `llegaste al máximo de ${MAX_MANUAL_JOBS_PER_PERSON} ofertas cargadas a mano`
        : `llegaste al máximo de espacio para avisos guardados (${Math.round(MAX_RAW_BYTES_PER_PERSON / 1024 / 1024)} MB)`,
    );
    this.name = "PersonQuotaError";
    this.kind = kind;
  }
}

/**
 * Decide la cuota de la persona dentro de la transacción del llamador: toma un lock por persona
 * que dura hasta el commit, mide lo que ya hay (ofertas manuales y bytes de `raw_blobs`) y falla
 * con `PersonQuotaError` si lo nuevo no entra. Con el lock, dos pedidos en paralelo no pasan los
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
  await db.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${userId}, ${PERSON_QUOTA_LOCK_NAMESPACE}))`,
  );
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
  const [blobs] = await db
    .select({ n: sql<number>`coalesce(sum(${s.rawBlobs.bytes}), 0)::float8` })
    .from(s.rawBlobs)
    .where(eq(s.rawBlobs.userId, userId));
  const verdict = checkPersonQuota(
    { manualJobs: Number(jobs?.n ?? 0), rawBytes: Number(blobs?.n ?? 0) },
    add,
    limits,
  );
  if (!verdict.ok) throw new PersonQuotaError(verdict.kind);
}
