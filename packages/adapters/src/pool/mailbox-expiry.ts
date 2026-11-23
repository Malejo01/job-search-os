import type { Db } from "@job-search-os/db";
import { sql, type SQL } from "drizzle-orm";
import { POOL_PARSER } from "../inbound/pool-mailbox";
import { POOL_EMAIL_RETENTION_DAYS } from "../retention/purge";

/** Días antes de la purga en los que se avisa (el aviso mira los próximos 7 días). */
export const POOL_MAILBOX_WARNING_DAYS = 7;

/**
 * Subconsulta de conteo: emails de la cola del pool (sin dueño y con el parser del pool) que siguen sin leer
 * ni descartar y cuya fecha de recepción ya pasó los (30 − 7) días, o sea, que la purga borra en los
 * próximos 7. Incluye los que ya pasaron los 30 días y todavía no se purgaron (la purga se atrasó).
 * Entra por `inbound_emails_user_received` (user_id IS NULL, received_at). Devuelve una sola fila con
 * un número: nunca filas, ids ni direcciones. «Sin leer» = `seen_at` y `dismissed_at` nulos.
 */
export function poolMailboxExpiringCountSql(
  now: Date,
  warningDays = POOL_MAILBOX_WARNING_DAYS,
): SQL {
  const cutoff = new Date(now.getTime() - (POOL_EMAIL_RETENTION_DAYS - warningDays) * 86_400_000);
  return sql`(select count(*) from inbound_emails
    where user_id is null
      and received_at < ${cutoff.toISOString()}::timestamptz
      and parser = ${POOL_PARSER}
      and seen_at is null
      and dismissed_at is null)`;
}

export async function countPoolMailboxExpiring(
  db: Db,
  now: Date,
  warningDays = POOL_MAILBOX_WARNING_DAYS,
): Promise<number> {
  const rows = (await db.execute(
    sql`select ${poolMailboxExpiringCountSql(now, warningDays)} as n`,
  )) as unknown as { n: number | string }[];
  return Number(rows[0]?.n ?? 0);
}
