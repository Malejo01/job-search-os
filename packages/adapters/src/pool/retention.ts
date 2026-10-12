import { schema as s, type Db } from "@job-search-os/db";
import { and, inArray, isNull, like, lt } from "drizzle-orm";

/**
 * Retención del pool (ADR-014): se borra la fila cuando la fuente dejó de devolverla hace más de
 * 30 días (`last_seen_at`). La cascada borra `public_job_skills`; `jobs.public_job_id` y
 * `dedup_of_id` quedan en null por la FK, así que las copias por usuario no se tocan y una copia
 * cuya raíz se purga pasa a ser raíz. También se borran los crudos que la fila referenciaba
 * (`raw_blobs` sin usuario, `kind` `pool_*`). El pool no es dato del usuario: no rige el mínimo
 * de `purgeExpired`.
 */
export const POOL_RETENTION_DAYS = 30;
export const POOL_PURGE_BATCH = 5_000;
/** Tope de lotes por corrida; lo que quede lo borra la próxima (cada 6 h). */
export const POOL_PURGE_MAX_BATCHES = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

export async function purgePool(
  db: Db,
  opts: { now?: Date; days?: number } = {},
): Promise<{ jobs: number; blobs: number }> {
  const now = opts.now ?? new Date();
  const cutoff = new Date(now.getTime() - (opts.days ?? POOL_RETENTION_DAYS) * DAY_MS);
  const t = s.publicJobs;
  const result = { jobs: 0, blobs: 0 };

  for (let i = 0; i < POOL_PURGE_MAX_BATCHES; i++) {
    const rows = await db
      .delete(t)
      .where(
        inArray(
          t.id,
          db.select({ id: t.id }).from(t).where(lt(t.lastSeenAt, cutoff)).limit(POOL_PURGE_BATCH),
        ),
      )
      .returning({ rawRef: t.rawRef });
    result.jobs += rows.length;

    const blobIds = rows
      .map((r) => r.rawRef)
      .filter((ref): ref is string => typeof ref === "string" && ref.startsWith("pg:"))
      .map((ref) => ref.slice(3));
    // Por trozos: una lista de ids muy larga excede los parámetros de una consulta
    for (let j = 0; j < blobIds.length; j += 1_000) {
      const deleted = await db
        .delete(s.rawBlobs)
        .where(
          and(
            inArray(s.rawBlobs.id, blobIds.slice(j, j + 1_000)),
            isNull(s.rawBlobs.userId),
            like(s.rawBlobs.kind, "pool\\_%"),
          ),
        )
        .returning({ id: s.rawBlobs.id });
      result.blobs += deleted.length;
    }
    if (rows.length < POOL_PURGE_BATCH) break;
  }
  return result;
}
