import { parseBetaMetrics, type BetaMetrics } from "@job-search-os/pipeline";
import { sql } from "drizzle-orm";
import { withUser } from "./db";
import { canCreateInvitations } from "./invitations";

/**
 * Métricas de la beta (C-14), solo servidor y solo admins. Dos barreras, como la lista de espera:
 * ADMIN_EMAILS acá y `app_admins` en la base (`admin_beta_metrics()`, rls/0009). La base devuelve
 * solo agregados con k-anonimato sobre personas; acá se validan y nada más.
 */
export type BetaMetricsResult =
  | { ok: true; metrics: BetaMetrics }
  | { ok: false; reason: "no_admin" | "no_habilitado" | "sin_datos" };

export async function getBetaMetrics(userId: string): Promise<BetaMetricsResult> {
  if (!(await canCreateInvitations(userId))) return { ok: false, reason: "no_admin" };
  try {
    const [row] = (await withUser(userId, (tx) =>
      tx.execute(sql`select admin_beta_metrics() as m`),
    )) as unknown as { m: unknown }[];
    const metrics = parseBetaMetrics(row?.m);
    return metrics ? { ok: true, metrics } : { ok: false, reason: "sin_datos" };
  } catch (error) {
    // Admin en ADMIN_EMAILS sin fila en app_admins, o la función todavía sin aplicar en la base
    for (let e: unknown = error; e && typeof e === "object"; e = (e as { cause?: unknown }).cause) {
      const message = (e as { message?: unknown }).message;
      if (typeof message === "string" && message.includes("admin_beta_metrics: no autorizado")) {
        return { ok: false, reason: "no_habilitado" };
      }
    }
    return { ok: false, reason: "sin_datos" };
  }
}
