import { schema as s, type Db } from "@job-search-os/db";
import {
  COVERAGE_VIGENTE_DAYS,
  salaryOriginalFromColumns,
  type MarketMinimalJob,
  type MarketMinimalSkill,
  type RoleKey,
} from "@job-search-os/pipeline";
import { and, eq, isNull, sql } from "drizzle-orm";

/**
 * `/market` mínimo (R34-03): lectura de lo que necesita `buildMarketMinimal`. Solo `public_jobs`,
 * `public_job_skills` y `skills` (el pool global, sin datos de personas). Dos consultas de solo lectura, las
 * mismas que ya hacía el mercado por carrera pero sin el texto del aviso y solo con la ventana de la vigencia
 * (7 días, `COVERAGE_VIGENTE_DAYS`): las cuentas se hacen en el pipeline. `db` puede ser una transacción.
 */
const DAY_MS = 86_400_000;
/** Tope de seguridad: una carrera con más avisos vigentes que esto es una anomalía. */
export const MARKET_MINIMAL_MAX_ROWS = 20_000;

export async function readMarketMinimalInput(
  db: Db,
  role: RoleKey,
  now: Date,
): Promise<{ jobs: MarketMinimalJob[]; skills: MarketMinimalSkill[] }> {
  const since = new Date(now.getTime() - COVERAGE_VIGENTE_DAYS * DAY_MS).toISOString();
  const roleJobs = and(
    isNull(s.publicJobs.dedupOfId),
    sql`${s.publicJobs.lastSeenAt} >= ${since}::timestamptz`,
    sql`${s.publicJobs.roleHints} @> ARRAY[${role}]::text[]`,
  );
  const c = s.publicJobs;
  const rows = await db
    .select({
      id: c.id,
      title: c.title,
      seniority: c.seniority,
      modality: c.modality,
      countriesAllowed: c.countriesAllowed,
      locationRaw: c.locationRaw,
      lastSeenAt: c.lastSeenAt,
      salaryOriginalMin: c.salaryOriginalMin,
      salaryOriginalMax: c.salaryOriginalMax,
      salaryOriginalCurrency: c.salaryOriginalCurrency,
      salaryOriginalPeriod: c.salaryOriginalPeriod,
    })
    .from(c)
    .where(roleJobs)
    .limit(MARKET_MINIMAL_MAX_ROWS + 1);
  if (rows.length > MARKET_MINIMAL_MAX_ROWS) throw new Error("market-minimal: demasiadas filas");

  const skills = rows.length
    ? await db
        .select({
          jobId: s.publicJobSkills.publicJobId,
          slug: s.skills.slug,
          name: s.skills.name,
          isMust: s.publicJobSkills.isMust,
        })
        .from(s.publicJobSkills)
        .innerJoin(c, eq(c.id, s.publicJobSkills.publicJobId))
        .innerJoin(s.skills, eq(s.skills.id, s.publicJobSkills.skillId))
        .where(roleJobs)
    : [];

  return {
    jobs: rows.map((r) => ({
      id: r.id,
      title: r.title,
      seniority: r.seniority,
      modality: r.modality,
      countriesAllowed: r.countriesAllowed,
      locationRaw: r.locationRaw,
      lastSeenAt: new Date(r.lastSeenAt),
      salaryOriginal: salaryOriginalFromColumns(r),
    })),
    skills,
  };
}
