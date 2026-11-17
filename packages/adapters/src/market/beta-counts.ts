import { schema as s, type Db } from "@job-search-os/db";
import { SHOWCASE_ACTIVE_MS, type RoleKey, type SourceKind } from "@job-search-os/pipeline";
import { and, inArray, isNull, sql } from "drizzle-orm";

/**
 * Número de la portada (R11-10): cuántas ofertas activas del pool son de las carreras de la beta y
 * cuántas de esas están en español. Una sola consulta agregada sobre `public_jobs`, sin leer filas:
 * nada de números fijos en la página. Mismo criterio de «activa» que la vitrina (sin copias, vista
 * en los últimos 7 días, solo fuentes de la lista de permitidos). Un aviso con varias carreras de
 * la beta cuenta una sola vez.
 *
 * «En español» usa el idioma ya calculado del aviso (`jd_language`) y, si todavía no se calculó, el
 * que declara la fuente (`lang`). Sin ninguno de los dos no se cuenta: el número es un piso, nunca
 * un techo inflado. `db` puede ser una transacción de solo lectura.
 */
export type BetaPoolCounts = { total: number; spanish: number };

export async function readBetaPoolCounts(
  db: Db,
  now: Date,
  sources: readonly SourceKind[],
  betaRoles: readonly RoleKey[],
): Promise<BetaPoolCounts> {
  if (sources.length === 0 || betaRoles.length === 0) return { total: 0, spanish: 0 };
  const since = new Date(now.getTime() - SHOWCASE_ACTIVE_MS);
  const roles = sql.join(
    betaRoles.map((r) => sql`${r}`),
    sql`, `,
  );
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      spanish: sql<number>`count(*) filter (where coalesce(${s.publicJobs.jdLanguage}, ${s.publicJobs.lang}) = 'es')::int`,
    })
    .from(s.publicJobs)
    .where(
      and(
        isNull(s.publicJobs.dedupOfId),
        sql`${s.publicJobs.lastSeenAt} >= ${since.toISOString()}::timestamptz`,
        inArray(s.publicJobs.sourceKind, [...sources]),
        sql`${s.publicJobs.roleHints} && ARRAY[${roles}]::text[]`,
      ),
    );
  return { total: row?.total ?? 0, spanish: row?.spanish ?? 0 };
}
