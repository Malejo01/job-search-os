import { schema as s, type Db } from "@job-search-os/db";
import {
  POOL_COVERAGE_LONG_DAYS,
  POOL_COVERAGE_SHORT_DAYS,
  parsePoolCoverageCounts,
  type PoolCoverageCount,
} from "@job-search-os/pipeline";
import { sql } from "drizzle-orm";
import { POOL_PARSER, readPoolInboundConfig } from "../inbound/pool-mailbox";

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

/**
 * Actividad de las casillas `pool-<carrera>@` (R19-04). Solo fechas, interruptores y conteos: ningún remitente,
 * asunto ni texto. `inbound_emails` no guarda el destinatario, así que la fecha por carrera sale de los avisos
 * que entraron por esa vía (`computrabajo_alerts`, `role_hints` = la carrera de la casilla): la última vez que
 * un email listó un aviso de esa carrera. La fecha global del último email de la cola del pool sí sale de
 * `inbound_emails` (sin dueño y con el parser del pool; índice `user_id, received_at`). Con la conexión de
 * servicio: esas filas no tienen dueño y la política por persona no las muestra.
 */
export type PoolMailboxActivity = {
  /** `POOL_SOURCE_COMPUTRABAJO_ALERTS === "1"`: las casillas están habilitadas. */
  mailboxesOn: boolean;
  /** `POOL_COMPUTRABAJO_READER === "1"`: el lector convierte los emails en avisos. */
  readerOn: boolean;
  /** Último email que quedó en la cola del pool (cola manual); null = ninguno. */
  lastQueueEmailAt: Date | null;
  /** Por carrera, en el orden pedido: última vez que un email listó un aviso; null = nunca. */
  lastAlertByRole: { role: string; lastAt: Date | null; offers: number }[];
};

export async function readPoolMailboxActivity(
  db: Db,
  roles: readonly string[],
  env: Record<string, string | undefined> = process.env,
): Promise<PoolMailboxActivity> {
  const cfg = readPoolInboundConfig(env);
  const queue = (await db.execute(sql`
    select max(received_at) as last_at from inbound_emails
    where user_id is null and parser = ${POOL_PARSER}
  `)) as unknown as { last_at: Date | string | null }[];
  const byRole = new Map<string, { lastAt: Date | null; offers: number }>();
  if (roles.length > 0) {
    const list = sql.join(
      roles.map((r) => sql`${r}`),
      sql`, `,
    );
    const rows = (await db.execute(sql`
      select r as role, max(last_seen_at) as last_at, count(*)::int as offers
      from public_jobs, unnest(role_hints) as r
      where source_kind = 'computrabajo_alerts'
        and role_hints && ARRAY[${list}]::text[]
        and r in (${list})
      group by r
    `)) as unknown as { role: string; last_at: Date | string | null; offers: number | string }[];
    for (const row of rows) {
      byRole.set(row.role, {
        lastAt: row.last_at ? new Date(row.last_at) : null,
        offers: Number(row.offers),
      });
    }
  }
  const last = queue[0]?.last_at;
  return {
    mailboxesOn: cfg.enabled,
    readerOn: cfg.computrabajoReader === true,
    lastQueueEmailAt: last ? new Date(last) : null,
    lastAlertByRole: roles.map((role) => ({
      role,
      lastAt: byRole.get(role)?.lastAt ?? null,
      offers: byRole.get(role)?.offers ?? 0,
    })),
  };
}

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
