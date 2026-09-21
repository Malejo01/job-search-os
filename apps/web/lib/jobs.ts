import { schema as s } from "@job-search-os/db";
import { JOB_STATUSES, type JobStatus } from "@job-search-os/pipeline";
import { and, desc, eq, gte, inArray, or, sql } from "drizzle-orm";
import { withUser } from "./db";
import { ACTIVE_STATUSES } from "./labels";
import { preScoresFor } from "./prescore";

/**
 * Lectura de la lista de ofertas (JS-015). Corre con el rol de la app y app.user_id fijado:
 * las policies filtran por usuario; acá solo hay filtros de UI. Todo serializable (fechas ISO)
 * para poder pasarlo a los client components de la lista.
 */
export type JobFilters = {
  /** Score mínimo de la última evaluación, entero de 0 a 9 (JS-029); null = sin filtro. */
  scoreMin: number | null;
  /** Fuente (job_sources.kind); null = todas. */
  source: string | null;
  /** Estado: un job_status, "todas", o null = activas (ACTIVE_STATUSES). */
  status: JobStatus | "todas" | null;
  /** first_seen_at ≥ fecha (YYYY-MM-DD); null = sin filtro. */
  since: string | null;
};

export type JobListRow = {
  id: string;
  title: string;
  company: string;
  status: JobStatus;
  locationRaw: string | null;
  modality: string | null;
  /** Link a la publicación original (canonical_url o, si no hay, la URL de alguna fuente). */
  url: string | null;
  firstSeenAt: string;
  postedAt: string | null;
  flags: string[];
  sources: string[];
  score: number | null;
  locationOk: string | null;
  accion: string | null;
  riesgos: string[];
  bloqueadores: string[];
  /** evaluations.model; "fake" = modo demo (badge DEMO). */
  model: string | null;
  /** Pre-score determinista (sin LLM) cuando no hay evaluación; null si ya hay score o no aplica. */
  preScore: number | null;
  /** Tiene la evaluación en curso o en cola (JS-027): se muestra arriba como "evaluando". */
  evaluating: boolean;
};

/**
 * Oferta con un mensaje de evaluación pendiente o en proceso (job_queue tiene RLS: solo las del
 * usuario). Es lo que pasa entre pegar el JD y que el modelo responda. Se usa en consultas sobre
 * `jobs`: la columna va calificada a mano porque en una consulta de una sola tabla drizzle la
 * escribe como `"id"` y, dentro de la subconsulta, eso sería el id de job_queue.
 */
export const evaluatingSql = () =>
  sql<boolean>`exists (select 1 from job_queue q where q.queue = 'evaluate_job' and q.status in ('pending', 'processing') and q.payload->>'jobId' = "jobs"."id"::text)`;

const SOURCE_KINDS = new Set<string>(s.sourceKind.enumValues);

export function parseJobFilters(params: Record<string, string | string[] | undefined>): JobFilters {
  const one = (k: string) => {
    const v = params[k];
    return (Array.isArray(v) ? v[0] : v) ?? "";
  };
  const score = one("score");
  const source = one("fuente");
  const status = one("estado");
  const since = one("desde");
  return {
    // Solo enteros de 0 a 9 (lo que ofrece el selector); cualquier otra cosa en la URL = sin filtro
    scoreMin: /^[0-9]$/.test(score) ? Number(score) : null,
    source: SOURCE_KINDS.has(source) ? source : null,
    status:
      status === "todas"
        ? "todas"
        : (JOB_STATUSES as readonly string[]).includes(status)
          ? (status as JobStatus)
          : null,
    since: /^\d{4}-\d{2}-\d{2}$/.test(since) ? since : null,
  };
}

export const LIST_LIMIT = 100;

export async function listJobs(userId: string, filters: JobFilters): Promise<JobListRow[]> {
  return withUser(userId, async (tx) => {
    // Última evaluación por job (la que manda para score, ubicación y acción)
    const latest = tx
      .selectDistinctOn([s.evaluations.jobId], {
        jobId: s.evaluations.jobId,
        score: s.evaluations.score,
        locationOk: s.evaluations.locationOk,
        accion: s.evaluations.accion,
        riesgos: s.evaluations.riesgos,
        bloqueadores: s.evaluations.bloqueadoresDuros,
        model: s.evaluations.model,
      })
      .from(s.evaluations)
      .orderBy(s.evaluations.jobId, desc(s.evaluations.createdAt))
      .as("latest");
    const sources = tx
      .select({
        jobId: s.jobSources.jobId,
        kinds: sql<string[]>`array_agg(distinct ${s.jobSources.kind}::text)`.as("kinds"),
        url: sql<string | null>`min(${s.jobSources.url})`.as("url"),
      })
      .from(s.jobSources)
      .groupBy(s.jobSources.jobId)
      .as("src");

    const conds = [
      filters.status === "todas"
        ? undefined
        : filters.status
          ? eq(s.jobs.status, filters.status)
          : inArray(s.jobs.status, [...ACTIVE_STATUSES]),
      // Lo que se está evaluando se ve aunque el filtro de score lo dejaría afuera (todavía no tiene score)
      filters.scoreMin !== null
        ? or(gte(latest.score, filters.scoreMin), evaluatingSql())
        : undefined,
      filters.source ? sql`${filters.source} = any(${sources.kinds})` : undefined,
      filters.since ? gte(s.jobs.firstSeenAt, new Date(`${filters.since}T00:00:00Z`)) : undefined,
    ].filter((c): c is NonNullable<typeof c> => c !== undefined);

    const rows = await tx
      .select({
        id: s.jobs.id,
        title: s.jobs.title,
        company: s.jobs.companyRaw,
        status: s.jobs.status,
        locationRaw: s.jobs.locationRaw,
        modality: s.jobs.modality,
        canonicalUrl: s.jobs.canonicalUrl,
        sourceUrl: sources.url,
        salaryMaxUsd: s.jobs.salaryMaxUsd,
        firstSeenAt: s.jobs.firstSeenAt,
        postedAt: s.jobs.postedAt,
        flags: s.jobs.flags,
        sources: sources.kinds,
        score: latest.score,
        locationOk: latest.locationOk,
        accion: latest.accion,
        riesgos: latest.riesgos,
        bloqueadores: latest.bloqueadores,
        model: latest.model,
        evaluating: evaluatingSql(),
      })
      .from(s.jobs)
      .leftJoin(latest, eq(latest.jobId, s.jobs.id))
      .leftJoin(sources, eq(sources.jobId, s.jobs.id))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(
        sql`${evaluatingSql()} desc`,
        sql`${latest.score} desc nulls last`,
        desc(s.jobs.firstSeenAt),
      )
      .limit(LIST_LIMIT);

    // Pre-score solo para las que todavía no tienen evaluación y no están descartadas
    const pending = rows.filter((r) => r.score === null && r.status !== "descartada_prefiltro");
    const pre = await preScoresFor(
      tx,
      userId,
      pending.map((r) => ({ id: r.id, flags: r.flags ?? [], salaryMaxUsd: r.salaryMaxUsd })),
    );
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      company: r.company,
      status: r.status,
      locationRaw: r.locationRaw,
      modality: r.modality,
      url: r.canonicalUrl ?? r.sourceUrl ?? null,
      firstSeenAt: r.firstSeenAt.toISOString(),
      postedAt: r.postedAt?.toISOString() ?? null,
      flags: r.flags ?? [],
      sources: r.sources ?? [],
      score: r.score,
      locationOk: r.locationOk,
      accion: r.accion,
      riesgos: r.riesgos ?? [],
      bloqueadores: r.bloqueadores ?? [],
      model: r.model,
      preScore: pre.get(r.id)?.score ?? null,
      evaluating: Boolean(r.evaluating),
    }));
  });
}
