import { createLogger, dailyCapFromEnv, safeDbError } from "@job-search-os/adapters";
import { buildSpendBoard, parseSpendBoard, type SpendBoard } from "@job-search-os/pipeline";
import { sql } from "drizzle-orm";
import { withUser } from "./db";
import { canCreateInvitations } from "./invitations";

/**
 * Tablero de gasto de IA (`/settings/costos`), solo servidor y solo admins. Dos barreras, como las
 * métricas de la beta: ADMIN_EMAILS acá y `app_admins` en la base (`admin_llm_spend_board()`,
 * rls/0055), que devuelve solo agregados de `llm_calls` de los últimos 30 días en una consulta. Acá se
 * validan y se arman las filas; el tope diario sale de la misma función que usa el worker.
 */
export type SpendBoardResult =
  | { ok: true; board: SpendBoard; capDailyUsd: number | null }
  | { ok: false; reason: "no_admin" | "no_habilitado" | "sin_datos" };

export const SPEND_BOARD_DAYS = 30;

export async function getSpendBoard(userId: string): Promise<SpendBoardResult> {
  if (!(await canCreateInvitations(userId))) return { ok: false, reason: "no_admin" };
  try {
    const [row] = (await withUser(userId, async (tx) => {
      await tx.execute(sql`set local statement_timeout = '3s'`);
      return tx.execute(sql`select admin_llm_spend_board(${SPEND_BOARD_DAYS}::int) as b`);
    })) as unknown as { b: unknown }[];
    const raw = parseSpendBoard(row?.b);
    if (!raw) return { ok: false, reason: "sin_datos" };
    // Mismo tope que el worker: sin la variable rige el valor por defecto; 0 = sin tope
    let cap: number | null;
    try {
      cap = dailyCapFromEnv(process.env);
    } catch {
      cap = null;
    }
    const capDailyUsd = cap !== null && cap > 0 ? cap : null;
    return { ok: true, board: buildSpendBoard(raw, capDailyUsd), capDailyUsd };
  } catch (error) {
    for (let e: unknown = error; e && typeof e === "object"; e = (e as { cause?: unknown }).cause) {
      const message = (e as { message?: unknown }).message;
      if (typeof message === "string" && message.includes("admin_llm_spend_board: no autorizado")) {
        return { ok: false, reason: "no_habilitado" };
      }
    }
    createLogger({ user_id: userId, task: "spend_board" }).error(
      { err: safeDbError(error) },
      "tablero de gasto: no se pudo leer",
    );
    return { ok: false, reason: "sin_datos" };
  }
}
