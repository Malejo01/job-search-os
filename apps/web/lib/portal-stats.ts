import { schema as s } from "@job-search-os/db";
import { portalStatsRows, sourceGroupOf, type PortalStatsRow } from "@job-search-os/pipeline";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { withUser } from "./db";

/** Ventana de «Qué portal te sirve» y mínimo de ofertas para mostrar conteos derivados. */
export const PORTAL_STATS_DAYS = 30;
export const PORTAL_STATS_MIN = 5;

/**
 * «Qué portal te sirve»: una fila por oferta de los últimos 30 días (`first_seen_at`) con su primera
 * fuente, su última evaluación y si tiene postulación o llegó a entrevista; se agrupa con la función
 * pura. Con el rol de la app y `app.user_id` fijado: RLS deja solo las de esta persona. Sin
 * historial de estados: una entrevista que terminó en rechazo no cuenta.
 */
export async function portalStats(userId: string, now: Date): Promise<PortalStatsRow[]> {
  const since = new Date(now.getTime() - PORTAL_STATS_DAYS * 24 * 60 * 60 * 1000);
  return withUser(userId, async (tx) => {
    const latest = tx
      .selectDistinctOn([s.evaluations.jobId], {
        jobId: s.evaluations.jobId,
        score: s.evaluations.score,
      })
      .from(s.evaluations)
      .orderBy(s.evaluations.jobId, desc(s.evaluations.createdAt))
      .as("latest");
    const source = tx
      .selectDistinctOn([s.jobSources.jobId], {
        jobId: s.jobSources.jobId,
        kind: s.jobSources.kind,
        sourceName: s.jobSources.sourceName,
      })
      .from(s.jobSources)
      .orderBy(s.jobSources.jobId, s.jobSources.seenAt, s.jobSources.id)
      .as("src");

    // Columnas calificadas a mano: dentro de la subconsulta drizzle las escribiría sin tabla
    const appliedSql = sql<boolean>`exists (select 1 from applications a where a.job_id = "jobs"."id")`;
    const interviewSql = sql<boolean>`(
      "jobs"."status" in ('entrevista', 'oferta')
      or exists (select 1 from applications a where a.job_id = "jobs"."id" and a.outcome in ('entrevista', 'oferta'))
    )`;

    const rows = await tx
      .select({
        kind: source.kind,
        sourceName: source.sourceName,
        score: latest.score,
        applied: appliedSql,
        interview: interviewSql,
      })
      .from(s.jobs)
      .leftJoin(latest, eq(latest.jobId, s.jobs.id))
      .leftJoin(source, eq(source.jobId, s.jobs.id))
      .where(and(eq(s.jobs.userId, userId), gte(s.jobs.firstSeenAt, since)));

    return portalStatsRows(
      rows.map((r) => ({
        // Sin fila en job_sources (no debería pasar): se cuenta como «Otra»
        group: sourceGroupOf(r.kind ?? "other", r.sourceName),
        score: r.score,
        applied: r.applied,
        interview: r.interview,
      })),
      { minForStats: PORTAL_STATS_MIN },
    );
  });
}
