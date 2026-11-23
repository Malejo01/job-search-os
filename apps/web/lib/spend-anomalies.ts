import { createLogger, safeDbError } from "@job-search-os/adapters";
import {
  detectSpendAnomalies,
  parseSpendAnomalyRows,
  type SpendAnomaly,
} from "@job-search-os/pipeline";
import { sql } from "drizzle-orm";
import { withUser } from "./db";
import { canCreateInvitations } from "./invitations";

/**
 * Anomalías de gasto de IA para `/settings/salud`, solo servidor y solo admins: una consulta agregada
 * (`admin_llm_spend_anomalies()`, rls/0056) con las dos barreras de siempre (ADMIN_EMAILS y
 * `app_admins`). La regla vive en pipeline. Si no se puede leer, devuelve `sin_datos`: el bloque lo dice
 * en vez de mostrar «sin anomalías».
 */
export type SpendAnomaliesResult =
  { ok: true; anomalies: SpendAnomaly[] } | { ok: false; reason: "no_admin" | "sin_datos" };

export async function getSpendAnomalies(userId: string): Promise<SpendAnomaliesResult> {
  if (!(await canCreateInvitations(userId))) return { ok: false, reason: "no_admin" };
  try {
    const [row] = (await withUser(userId, async (tx) => {
      await tx.execute(sql`set local statement_timeout = '3s'`);
      return tx.execute(sql`select admin_llm_spend_anomalies() as a`);
    })) as unknown as { a: unknown }[];
    const rows = parseSpendAnomalyRows(row?.a);
    if (!rows) return { ok: false, reason: "sin_datos" };
    return { ok: true, anomalies: detectSpendAnomalies(rows) };
  } catch (error) {
    createLogger({ user_id: userId, task: "spend_anomalies" }).error(
      { err: safeDbError(error) },
      "anomalías de gasto: no se pudo leer",
    );
    return { ok: false, reason: "sin_datos" };
  }
}
