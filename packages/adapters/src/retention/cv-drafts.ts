import { type Db } from "@job-search-os/db";
import { CV_DRAFT_RETENTION_DAYS } from "@job-search-os/pipeline";
import { sql } from "drizzle-orm";

const DAY_MS = 24 * 60 * 60 * 1000;
const BATCH = 5_000;
const MAX_BATCHES = 10;

/**
 * Limpieza de borradores del CV sin uso (R33-02): un borrador (`cv_drafts`) se borra solo cuando pasaron
 * `CV_DRAFT_RETENTION_DAYS` (30) días desde la última vez que se guardó o retomó (`updated_at`). `db` es la
 * conexión de servicio (ve las filas de todas las personas); el borrado es global por antigüedad y no cruza datos
 * entre personas. Va en lotes para no tomar locks largos; lo que quede lo borra la próxima corrida. Devuelve
 * cuántos borró. Programarla (cron) es un paso manual del responsable (`docs/beta/pasos-manuales-r33.md`).
 */
export async function purgeStaleCvDrafts(
  db: Db,
  options: { days?: number; now?: () => Date; batchSize?: number } = {},
): Promise<number> {
  const days = options.days ?? CV_DRAFT_RETENTION_DAYS;
  const batch = options.batchSize ?? BATCH;
  const cutoff = new Date((options.now ?? (() => new Date()))().getTime() - days * DAY_MS);
  let total = 0;
  for (let i = 0; i < MAX_BATCHES; i++) {
    const rows = (await db.execute(sql`
      delete from cv_drafts
       where id in (
         select id from cv_drafts
          where updated_at <= ${cutoff.toISOString()}::timestamptz
          limit ${batch})
      returning id`)) as unknown as unknown[];
    total += rows.length;
    if (rows.length < batch) break;
  }
  return total;
}
