import { createLogger, recomputeMarketForUser, safeDbError } from "@job-search-os/adapters";
import { createDb, requireDatabaseUrl } from "@job-search-os/db";
import { after } from "next/server";

/**
 * Recálculo de mercado y plan después de responder (ronda 28): `after()` + conexión de servicio +
 * `recomputeMarketForUser`. Si falla, se loguea y el usuario no se entera. El log lleva solo el
 * usuario, la tarea y el resultado: ni skills ni ids de ofertas.
 */
export function scheduleMarketRecompute(userId: string, options: { inputsChanged: boolean }): void {
  after(async () => {
    const logger = createLogger({ user_id: userId, task: "market_recompute" });
    let conn: ReturnType<typeof createDb> | null = null;
    try {
      conn = createDb(requireDatabaseUrl({ purpose: "service" }), { max: 2 });
      const result = await recomputeMarketForUser(conn.db, {
        userId,
        inputsChanged: options.inputsChanged,
      });
      logger.info(
        result.ran ? { ran: true } : { ran: false, reason: result.reason },
        "recálculo de mercado",
      );
    } catch (e) {
      logger.error({ err: safeDbError(e) }, "recálculo de mercado falló");
    } finally {
      await conn?.close().catch(() => {});
    }
  });
}
