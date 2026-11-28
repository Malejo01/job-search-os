import { type Db } from "@job-search-os/db";
import { sql } from "drizzle-orm";

/**
 * Limpieza de fichas huérfanas (R31-S5, ADR-048): una ficha sale del texto de un aviso, y el texto de un aviso
 * pegado sobrevive a la oferta y a la cuenta. Se borran las fichas cuyo hash ya no está en ninguna oferta
 * (`jobs.jd_hash`) ni en el pool (`public_jobs.jd_hash`). Una ficha que se vuelve a pedir se vuelve a generar.
 * `db` es la conexión de servicio. Con `olderThanHours` (default 24) no toca las recién generadas, que pueden
 * estar esperando que la oferta se guarde. Devuelve cuántas borró.
 */
export async function purgeOrphanJobCards(
  db: Db,
  options: { olderThanHours?: number; now?: () => Date } = {},
): Promise<number> {
  const hours = options.olderThanHours ?? 24;
  const cutoff = new Date((options.now ?? (() => new Date()))().getTime() - hours * 3_600_000);
  const rows = await db.execute(sql`
    delete from job_cards c
     where c.created_at < ${cutoff.toISOString()}::timestamptz
       and not exists (select 1 from jobs j where j.jd_hash = c.jd_hash)
       and not exists (select 1 from public_jobs p where p.jd_hash = c.jd_hash)
    returning c.id`);
  return (rows as unknown as unknown[]).length;
}
