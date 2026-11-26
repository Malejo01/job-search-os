import { schema as s } from "@job-search-os/db";
import { isGoneFromSource } from "@job-search-os/pipeline";
import { eq, sql } from "drizzle-orm";
import { withUser } from "./db";
import { isUuid } from "./ids";

/**
 * Lo que el detalle necesita de R30-03 y R30-07 en una sola consulta: si la oferta está guardada y,
 * si viene del pool, si la fuente ya no la muestra. Mismas reglas que la tarjeta (`isGoneFromSource`).
 * Con RLS: una oferta de otra persona no existe para quien llama (devuelve null).
 */
export type JobListingState = {
  /** Fecha ISO de la marca «Guardada»; null = no guardada. */
  savedAt: string | null;
  goneFromSource: boolean;
  /** Nombre de la fuente del pool; null si no viene del pool. */
  sourceName: string | null;
};

export async function getJobListingState(
  userId: string,
  jobId: string,
  now: Date = new Date(),
): Promise<JobListingState | null> {
  if (!isUuid(jobId)) return null;
  return withUser(userId, async (tx) => {
    const [row] = await tx
      .select({
        savedAt: s.jobs.savedAt,
        publicJobId: s.jobs.publicJobId,
        sourceName: s.publicJobs.sourceName,
        lastSeenAt: s.publicJobs.lastSeenAt,
        poolNewestSeenAt: sql<Date | string | null>`(select max(last_seen_at) from public_jobs)`,
      })
      .from(s.jobs)
      .leftJoin(s.publicJobs, eq(s.publicJobs.id, s.jobs.publicJobId))
      .where(eq(s.jobs.id, jobId))
      .limit(1);
    if (!row) return null;
    const newest = row.poolNewestSeenAt === null ? null : new Date(row.poolNewestSeenAt);
    return {
      savedAt: row.savedAt?.toISOString() ?? null,
      goneFromSource: isGoneFromSource({
        fromPool: row.publicJobId !== null,
        lastSeenAt: row.lastSeenAt,
        poolNewestSeenAt: newest,
        now,
      }),
      sourceName: row.publicJobId !== null ? (row.sourceName ?? null) : null,
    };
  });
}
