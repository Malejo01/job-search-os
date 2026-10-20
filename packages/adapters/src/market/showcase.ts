import { schema as s, type Db } from "@job-search-os/db";
import {
  SHOWCASE_ACTIVE_MS,
  SHOWCASE_OFFERS_FRESH_MS,
  type PoolShowcaseInput,
  type RoleKey,
  type ShowcaseJobRow,
  type SourceKind,
} from "@job-search-os/pipeline";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";

/**
 * Vitrina pública (ronda 63): lecturas del pool para la portada, /mercado y /ofertas. Solo
 * `public_jobs`, `public_job_skills` y `skills`: ninguna tabla de usuarios. Selects acotados y sin
 * `jd_text`. `db` puede ser una transacción de solo lectura.
 */

/**
 * Sin copia, visto dentro de la ventana (`windowMs`) y de una de las fuentes permitidas
 * (`SHOWCASE_SOURCES`: lista de permitidos, una lista vacía no trae nada).
 */
function activeWhere(now: Date, windowMs: number, sources: readonly SourceKind[]) {
  const since = new Date(now.getTime() - windowMs);
  return and(
    isNull(s.publicJobs.dedupOfId),
    sql`${s.publicJobs.lastSeenAt} >= ${since.toISOString()}::timestamptz`,
    inArray(s.publicJobs.sourceKind, [...sources]),
  );
}

/** Números del pool: avisos activos (vistos en los últimos 7 días) de las fuentes permitidas. */
export async function readPoolShowcaseInput(
  db: Db,
  now: Date,
  sources: readonly SourceKind[],
): Promise<PoolShowcaseInput> {
  const rows = await db
    .select({
      roleHints: s.publicJobs.roleHints,
      modality: s.publicJobs.modality,
      countriesAllowed: s.publicJobs.countriesAllowed,
      locationRaw: s.publicJobs.locationRaw,
      companyRaw: s.publicJobs.companyRaw,
      sourceKind: s.publicJobs.sourceKind,
      firstSeenAt: s.publicJobs.firstSeenAt,
    })
    .from(s.publicJobs)
    .where(activeWhere(now, SHOWCASE_ACTIVE_MS, sources));

  // max(last_seen_at) de las fuentes permitidas: "actualizado hace X h" habla de lo que se muestra
  const [pool] = await db
    .select({ last: sql<Date | string | null>`max(${s.publicJobs.lastSeenAt})` })
    .from(s.publicJobs)
    .where(inArray(s.publicJobs.sourceKind, [...sources]));

  return {
    jobs: rows.map((r) => ({ ...r, firstSeenAt: toIso(r.firstSeenAt) })),
    poolUpdatedAt: pool?.last ? toIso(pool.last) : null,
    now: now.toISOString(),
  };
}

/**
 * Los avisos más recientes (opcionalmente de una carrera) con sus skills, listos para
 * `pickShowcaseJobs`. Solo los vistos en las últimas 72 h: no se muestran avisos que pueden haberse cerrado.
 */
export async function readShowcaseJobs(
  db: Db,
  opts: { role?: RoleKey; limit: number; sources: readonly SourceKind[] },
  now: Date,
): Promise<ShowcaseJobRow[]> {
  const published = sql<
    Date | string
  >`coalesce(${s.publicJobs.postedAt}, ${s.publicJobs.firstSeenAt})`;
  const jobs = await db
    .select({
      id: s.publicJobs.id,
      title: s.publicJobs.title,
      companyRaw: s.publicJobs.companyRaw,
      locationRaw: s.publicJobs.locationRaw,
      modality: s.publicJobs.modality,
      sourceKind: s.publicJobs.sourceKind,
      sourceUrl: s.publicJobs.sourceUrl,
      publishedAt: published,
    })
    .from(s.publicJobs)
    .where(
      and(
        activeWhere(now, SHOWCASE_OFFERS_FRESH_MS, opts.sources),
        opts.role ? sql`${s.publicJobs.roleHints} @> ARRAY[${opts.role}]::text[]` : undefined,
      ),
    )
    // Un aviso con fecha en el futuro no debe quedar primero para siempre
    .orderBy(sql`least(${published}, ${now.toISOString()}::timestamptz) desc`, s.publicJobs.id)
    .limit(Math.max(0, Math.floor(opts.limit)));
  if (!jobs.length) return [];

  const skillRows = await db
    .select({
      jobId: s.publicJobSkills.publicJobId,
      name: s.skills.name,
      isMust: s.publicJobSkills.isMust,
    })
    .from(s.publicJobSkills)
    .innerJoin(s.skills, eq(s.skills.id, s.publicJobSkills.skillId))
    .where(
      inArray(
        s.publicJobSkills.publicJobId,
        jobs.map((j) => j.id),
      ),
    );

  const byJob = new Map<string, { name: string; isMust: boolean }[]>();
  for (const k of skillRows) {
    const list = byJob.get(k.jobId) ?? [];
    list.push({ name: k.name, isMust: k.isMust });
    byJob.set(k.jobId, list);
  }
  return jobs.map((j) => ({
    ...j,
    publishedAt: toIso(j.publishedAt),
    skills: byJob.get(j.id) ?? [],
  }));
}

/** `sql<Date>` no pasa por el mapeo de drizzle: el driver puede devolver Date o texto. */
function toIso(v: Date | string): string {
  return (v instanceof Date ? v : new Date(v)).toISOString();
}
