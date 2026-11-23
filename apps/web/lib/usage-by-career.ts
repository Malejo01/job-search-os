import { buildUsageGrid, parseUsageRows, type UsageGrid } from "@job-search-os/pipeline";
import { sql } from "drizzle-orm";
import { withUser } from "./db";
import { canCreateInvitations } from "./invitations";

/**
 * Uso por carrera y por semana (R22-04), solo servidor y solo admins. Mismas dos barreras que las demás
 * métricas: ADMIN_EMAILS acá y `app_admins` en la base (`admin_usage_by_career()`, rls/0057). La base
 * devuelve una sola consulta con agregados ya enmascarados (menos de 3 personas no sale); acá se valida
 * la forma y se arma la grilla. Sin emails, nombres ni ids.
 */
export type UsageByCareerResult =
  { ok: true; grid: UsageGrid } | { ok: false; reason: "no_admin" | "no_habilitado" | "sin_datos" };

export async function getUsageByCareer(
  userId: string,
  now: Date = new Date(),
): Promise<UsageByCareerResult> {
  if (!(await canCreateInvitations(userId))) return { ok: false, reason: "no_admin" };
  try {
    const raw = (await withUser(userId, (tx) =>
      tx.execute(
        sql`select week::text as week, career, metric, value, people from admin_usage_by_career()`,
      ),
    )) as unknown as unknown[];
    const rows = parseUsageRows(Array.from(raw));
    return rows
      ? { ok: true, grid: buildUsageGrid(rows, now) }
      : { ok: false, reason: "sin_datos" };
  } catch (error) {
    // Admin en ADMIN_EMAILS sin fila en app_admins, o la función todavía sin aplicar en la base
    for (let e: unknown = error; e && typeof e === "object"; e = (e as { cause?: unknown }).cause) {
      const message = (e as { message?: unknown }).message;
      if (typeof message === "string" && message.includes("admin_usage_by_career: no autorizado")) {
        return { ok: false, reason: "no_habilitado" };
      }
    }
    return { ok: false, reason: "sin_datos" };
  }
}
