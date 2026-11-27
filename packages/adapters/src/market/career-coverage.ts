import { schema as s, type Db } from "@job-search-os/db";
import { COVERAGE_TREND_DAYS, type CoverageJob } from "@job-search-os/pipeline";
import { sql } from "drizzle-orm";

/**
 * Avisos del pool para el panel de cobertura (R32-02): UNA consulta de solo lectura sobre `public_jobs`, el
 * pool global (sin datos de personas ni cruce con tablas de usuarios). Trae solo lo que las reglas de
 * `careerCoverage` necesitan (carrera, fuente, países, ubicación, nivel, título e idioma): la cuenta se hace
 * en el pipeline, así vigente, tomable y «para quien empieza» tienen una sola definición.
 *
 * Filtro: sin copias (`dedup_of_id` nulo), vistos por última vez dentro de la ventana de la tendencia (14
 * días: cubre los vigentes, que son 7, y todo lo que entró en esos 14) y con alguna de las carreras pedidas
 * (índice GIN `public_jobs_role_hints`; `public_jobs_last_seen` acota por fecha). Ningún texto largo.
 * `db` puede ser una transacción de solo lectura.
 */
const DAY_MS = 86_400_000;
/** Tope de seguridad: un pool con más filas que esto es una anomalía, no un panel lento. */
export const CAREER_COVERAGE_MAX_ROWS = 50_000;

export async function readCareerCoverageJobs(
  db: Db,
  roles: readonly string[],
  now: Date,
): Promise<CoverageJob[]> {
  if (roles.length === 0) return [];
  const since = new Date(now.getTime() - COVERAGE_TREND_DAYS * DAY_MS).toISOString();
  const list = sql.join(
    roles.map((r) => sql`${r}`),
    sql`, `,
  );
  const c = s.publicJobs;
  const rows = await db
    .select({
      roleHints: c.roleHints,
      sourceKind: c.sourceKind,
      countriesAllowed: c.countriesAllowed,
      locationRaw: c.locationRaw,
      seniority: c.seniority,
      title: c.title,
      language: sql<string | null>`coalesce(${c.jdLanguage}, ${c.lang})`,
      firstSeenAt: c.firstSeenAt,
      lastSeenAt: c.lastSeenAt,
    })
    .from(c)
    .where(
      sql`${c.dedupOfId} is null
        and ${c.lastSeenAt} >= ${since}::timestamptz
        and ${c.roleHints} && ARRAY[${list}]::text[]`,
    )
    .limit(CAREER_COVERAGE_MAX_ROWS + 1);
  if (rows.length > CAREER_COVERAGE_MAX_ROWS) throw new Error("career-coverage: demasiadas filas");
  return rows.map((r) => ({
    roleHints: r.roleHints,
    sourceKind: r.sourceKind,
    countriesAllowed: r.countriesAllowed,
    locationRaw: r.locationRaw,
    locationCountry: null,
    seniority: r.seniority,
    title: r.title,
    language: r.language,
    firstSeenAt: new Date(r.firstSeenAt),
    lastSeenAt: new Date(r.lastSeenAt),
  }));
}
