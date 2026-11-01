import { schema as s, type Db } from "@job-search-os/db";
import { CAREER_REVEAL_WINDOW_DAYS, type CareerRevealCount } from "@job-search-os/pipeline";
import { sql } from "drizzle-orm";

/**
 * Ofertas del pool por carrera oculta (C4-3): UNA consulta agregada sobre `public_jobs` (sin copias y
 * dentro de la ventana de 30 días), que devuelve solo `role`, `received` y `active`: nunca títulos ni
 * textos de los avisos. `received` cuenta las vistas por primera vez en la ventana; `active`, las vistas
 * por última vez (las que muestra la página de mercado). `db` puede ser una transacción.
 */
const DAY_MS = 24 * 60 * 60 * 1000;

export async function readCareerRevealCounts(
  db: Db,
  roles: readonly string[],
  now: Date,
): Promise<CareerRevealCount[]> {
  if (roles.length === 0) return [];
  const since = new Date(now.getTime() - CAREER_REVEAL_WINDOW_DAYS * DAY_MS).toISOString();
  const list = sql.join(
    roles.map((r) => sql`${r}`),
    sql`, `,
  );
  const rows = await db
    .select({
      role: sql<string>`r`,
      received: sql<number>`count(*) filter (where ${s.publicJobs.firstSeenAt} >= ${since}::timestamptz)::int`,
      active: sql<number>`count(*)::int`,
    })
    .from(sql`${s.publicJobs}, unnest(${s.publicJobs.roleHints}) as r`)
    .where(
      sql`${s.publicJobs.dedupOfId} is null
        and ${s.publicJobs.lastSeenAt} >= ${since}::timestamptz
        and ${s.publicJobs.roleHints} && ARRAY[${list}]::text[]
        and r in (${list})`,
    )
    .groupBy(sql`r`);
  return rows.map((row) => ({
    role: row.role,
    received: Number(row.received),
    active: Number(row.active),
  }));
}
