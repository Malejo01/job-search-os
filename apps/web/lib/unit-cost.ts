import { createLogger, safeDbError } from "@job-search-os/adapters";
import { createDb, requireDatabaseUrl } from "@job-search-os/db";
import { computeUnitCosts, type UnitCostReport } from "@job-search-os/pipeline";
import { sql } from "drizzle-orm";
import { unstable_cache } from "next/cache";
import { canReadAdminData } from "./invitations";
import { readUnitCostRows, UNIT_COST_WINDOW_DAYS } from "./unit-cost-rows";

/**
 * Costo por unidad (tablero de costos), solo servidor y solo admins (ADMIN_EMAILS). Como la salud de la
 * beta, lee agregados entre personas por la conexión de servicio: tres consultas agregadas con
 * `statement_timeout` de 5 s, cacheadas 5 minutos. Nunca devuelve ids, emails ni textos.
 */
async function read(nowIso: string) {
  const { db, close } = createDb(requireDatabaseUrl({ purpose: "service" }), { max: 1 });
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`set local statement_timeout = '5s'`);
      return readUnitCostRows(tx, new Date(nowIso));
    });
  } finally {
    await close();
  }
}

const cachedRead = unstable_cache(read, ["unit-cost"], { revalidate: 300 });

export type UnitCostResult =
  | { ok: true; report: UnitCostReport; windowDays: number; at: Date }
  | { ok: false; reason: "no_admin" | "sin_datos" };

export async function getUnitCosts(userId: string): Promise<UnitCostResult> {
  if (!(await canReadAdminData(userId))) return { ok: false, reason: "no_admin" };
  // La clave del caché es el minuto redondeado a 5: dentro de 5 min devuelve lo mismo
  const now = new Date();
  now.setSeconds(0, 0);
  now.setMinutes(now.getMinutes() - (now.getMinutes() % 5));
  try {
    const rows = await cachedRead(now.toISOString());
    const report = computeUnitCosts(rows);
    if (!report.ok) return { ok: false, reason: "sin_datos" };
    return { ok: true, report: report.value, windowDays: UNIT_COST_WINDOW_DAYS, at: now };
  } catch (e) {
    createLogger({ user_id: userId, task: "unit_cost" }).error(
      { err: safeDbError(e) },
      "costo por unidad: no se pudo leer",
    );
    return { ok: false, reason: "sin_datos" };
  }
}
