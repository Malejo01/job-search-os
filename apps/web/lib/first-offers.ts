import { schema as s } from "@job-search-os/db";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { withUser } from "./db";
import { preScoresFor } from "./prescore";

/** Cuántas filas se leen antes de ordenar en código y quedarse con las primeras. */
const READ_CAP = 300;

/**
 * «Tus primeras ofertas» (onboarding, ronda 39): las ofertas del usuario que salieron del pool
 * público (`jobs.public_job_id` no nulo), con su fuente y su score si ya se evaluaron. Corre con el
 * rol de la app y `app.user_id` fijado: las policies de RLS dejan solo las de esa persona.
 * Todo serializable (fechas ISO) por si alguna vez se pasa a un componente de cliente.
 */
export const FIRST_OFFERS_LIMIT = 30;

export type FirstOffer = {
  id: string;
  title: string;
  company: string;
  /** `job_sources.kind` de la fuente (getonboard_api, remoteok, ...); null si no tiene fuente. */
  sourceKind: string | null;
  /** `job_sources.source_name` (por ejemplo "Get on Board · programming"). */
  sourceName: string | null;
  /** URL del aviso original en la fuente (sin validar: la pantalla usa `safeHttpUrl`). */
  sourceUrl: string | null;
  /** Score de la última evaluación; null = todavía sin evaluar. */
  score: number | null;
  /** Tiene un mensaje de evaluación pendiente o en proceso en la cola. */
  evaluating: boolean;
  firstSeenAt: string;
};

/**
 * Mismo criterio que «En cola» en lib/jobs.ts (copiado, no importado): mensaje de `evaluate_job`
 * pendiente o en proceso para esta oferta. La columna va calificada a mano porque dentro de la
 * subconsulta drizzle la escribiría como `"id"` y sería el id de job_queue.
 */
const evaluatingSql = () =>
  sql<boolean>`exists (select 1 from job_queue q where q.queue = 'evaluate_job' and q.status in ('pending', 'processing') and q.payload->>'jobId' = "jobs"."id"::text)`;

/**
 * Ventana de «estamos buscando» (ronda 44): tras guardar el perfil, la asignación del pool corre en
 * segundo plano. Durante estos minutos una lista vacía se lee como «todavía buscando» y la página
 * se refresca; pasados, se muestra «por ahora no hay ofertas» sin refresco.
 */
export const SEARCHING_WINDOW_MINUTES = 5;

/** Pura: ¿estamos dentro de la ventana de búsqueda? Sin fecha de perfil, no (vacío definitivo). */
export function isSearchingWindow(
  profileUpdatedAt: Date | null,
  now: Date,
  windowMinutes: number = SEARCHING_WINDOW_MINUTES,
): boolean {
  if (!profileUpdatedAt) return false;
  const elapsedMs = now.getTime() - profileUpdatedAt.getTime();
  return elapsedMs >= 0 && elapsedMs < windowMinutes * 60_000;
}

/** Última actualización del perfil (`profiles.updated_at`, que el paso 1 fija al guardar); null si no hay perfil. */
export async function getProfileUpdatedAt(userId: string): Promise<Date | null> {
  return withUser(userId, async (tx) => {
    const [row] = await tx
      .select({ updatedAt: s.profiles.updatedAt })
      .from(s.profiles)
      .where(eq(s.profiles.userId, userId))
      .limit(1);
    return row?.updatedAt ?? null;
  });
}

export async function listFirstOffers(
  userId: string,
  limit: number = FIRST_OFFERS_LIMIT,
): Promise<FirstOffer[]> {
  const take = Math.max(1, Math.min(limit, FIRST_OFFERS_LIMIT));
  return withUser(userId, async (tx) => {
    // Última evaluación por oferta (la que manda para el score)
    const latest = tx
      .selectDistinctOn([s.evaluations.jobId], {
        jobId: s.evaluations.jobId,
        score: s.evaluations.score,
      })
      .from(s.evaluations)
      .orderBy(s.evaluations.jobId, desc(s.evaluations.createdAt))
      .as("latest");
    // Una fuente por oferta: la primera que se vio
    const source = tx
      .selectDistinctOn([s.jobSources.jobId], {
        jobId: s.jobSources.jobId,
        kind: s.jobSources.kind,
        sourceName: s.jobSources.sourceName,
        url: s.jobSources.url,
      })
      .from(s.jobSources)
      .orderBy(s.jobSources.jobId, s.jobSources.seenAt, s.jobSources.id)
      .as("src");

    // Todas comparten casi el mismo `first_seen_at`: el orden real se arma en código (abajo). Tope
    // de lectura alto pero finito; con RLS son solo las de esta persona.
    const rows = await tx
      .select({
        id: s.jobs.id,
        title: s.jobs.title,
        company: s.jobs.companyRaw,
        sourceKind: source.kind,
        sourceName: source.sourceName,
        sourceUrl: source.url,
        score: latest.score,
        evaluating: evaluatingSql(),
        firstSeenAt: s.jobs.firstSeenAt,
        postedAt: s.jobs.postedAt,
        flags: s.jobs.flags,
        salaryMaxUsd: s.jobs.salaryMaxUsd,
      })
      .from(s.jobs)
      .leftJoin(latest, eq(latest.jobId, s.jobs.id))
      .leftJoin(source, eq(source.jobId, s.jobs.id))
      .where(and(eq(s.jobs.userId, userId), isNotNull(s.jobs.publicJobId)))
      .orderBy(desc(s.jobs.firstSeenAt), s.jobs.id)
      .limit(READ_CAP);

    // Pre-score solo de las que no tienen evaluación (sin LLM, se calcula al leer)
    const pending = rows.filter((r) => r.score === null);
    const pre = await preScoresFor(
      tx,
      userId,
      pending.map((r) => ({ id: r.id, flags: r.flags ?? [], salaryMaxUsd: r.salaryMaxUsd })),
    );
    const time = (d: Date | null) => d?.getTime() ?? 0;
    // Evaluadas por score; después las demás por pre-score; después las más recientes; id al final
    const ordered = [...rows]
      .sort(
        (a, b) =>
          (a.score === null ? 1 : 0) - (b.score === null ? 1 : 0) ||
          (b.score ?? 0) - (a.score ?? 0) ||
          (pre.get(b.id)?.score ?? 0) - (pre.get(a.id)?.score ?? 0) ||
          time(b.postedAt) - time(a.postedAt) ||
          (a.id < b.id ? -1 : 1),
      )
      .slice(0, take);

    return ordered.map((r) => ({
      id: r.id,
      title: r.title,
      company: r.company,
      sourceKind: r.sourceKind ?? null,
      sourceName: r.sourceName ?? null,
      sourceUrl: r.sourceUrl ?? null,
      score: r.score ?? null,
      evaluating: Boolean(r.evaluating),
      firstSeenAt: r.firstSeenAt.toISOString(),
    }));
  });
}
