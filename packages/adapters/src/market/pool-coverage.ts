import { schema as s, type Db } from "@job-search-os/db";
import {
  POOL_COVERAGE_LONG_DAYS,
  POOL_COVERAGE_SHORT_DAYS,
  parsePoolCoverageCounts,
  type PoolCoverageCount,
} from "@job-search-os/pipeline";
import { sql } from "drizzle-orm";

/**
 * Cobertura del pool por carrera y fuente (R16-4): UNA consulta agregada y de solo lectura sobre
 * `public_jobs`, el pool global (sin datos de personas ni cruce con tablas de usuarios). Devuelve solo
 * carrera, fuente y conteos: nunca títulos, empresas ni textos de avisos.
 *
 * «Activa en N días» = sin copias (`dedup_of_id` nulo) y vista por última vez dentro de los últimos N días
 * (`last_seen_at`). No usa `posted_at` ni `first_seen_at`. Un aviso con varias carreras entra una vez en cada
 * una (se despliega `role_hints`). «En español» = `coalesce(jd_language, lang) = 'es'`; sin dato no cuenta.
 * `db` puede ser una transacción de solo lectura. Falla cerrado: si la base devuelve una forma inesperada, tira.
 */
const DAY_MS = 24 * 60 * 60 * 1000;

export async function readPoolCoverage(
  db: Db,
  roles: readonly string[],
  now: Date,
): Promise<PoolCoverageCount[]> {
  if (roles.length === 0) return [];
  const since7 = new Date(now.getTime() - POOL_COVERAGE_SHORT_DAYS * DAY_MS).toISOString();
  const since30 = new Date(now.getTime() - POOL_COVERAGE_LONG_DAYS * DAY_MS).toISOString();
  const list = sql.join(
    roles.map((r) => sql`${r}`),
    sql`, `,
  );
  const c = s.publicJobs;
  const isSpanish = sql`coalesce(${c.jdLanguage}, ${c.lang}) = 'es'`;
  const recent = sql`${c.lastSeenAt} >= ${since7}::timestamptz`;
  const rows = await db
    .select({
      role: sql<string>`r`,
      source: sql<string>`${c.sourceKind}`,
      active7: sql<number>`count(*) filter (where ${recent})::int`,
      active30: sql<number>`count(*)::int`,
      spanish7: sql<number>`count(*) filter (where ${recent} and ${isSpanish})::int`,
      spanish30: sql<number>`count(*) filter (where ${isSpanish})::int`,
    })
    .from(sql`${c}, unnest(${c.roleHints}) as r`)
    .where(
      sql`${c.dedupOfId} is null
        and ${c.lastSeenAt} >= ${since30}::timestamptz
        and ${c.roleHints} && ARRAY[${list}]::text[]
        and r in (${list})`,
    )
    .groupBy(sql`r`, c.sourceKind);
  const parsed = parsePoolCoverageCounts(
    rows.map((row) => ({
      role: row.role,
      source: row.source,
      active7: Number(row.active7),
      active30: Number(row.active30),
      spanish7: Number(row.spanish7),
      spanish30: Number(row.spanish30),
    })),
  );
  if (!parsed) throw new Error("pool-coverage: forma inesperada");
  return parsed;
}
