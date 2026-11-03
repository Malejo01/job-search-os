import { createLogger, safeDbError } from "@job-search-os/adapters";
import {
  normalizeAccesoOrigin,
  parseAccesoFunnelRows,
  type AccesoFunnelRow,
  type AccesoFunnelStep,
} from "@job-search-os/pipeline";
import { sql } from "drizzle-orm";
import { assertAppRole, getAppDb, withUser } from "./db";
import { canCreateInvitations } from "./invitations";

/**
 * Embudo de /acceso (C8-2), solo servidor. Contadores agregados sin personas: ni email, ni IP, ni id
 * (`acceso_funnel`, rls/0016). Apagado por defecto: `ACCESO_FUNNEL_ENABLED=1` lo prende, después de
 * aplicar la migración 0057. Contar nunca rompe /acceso: un error se loguea y se sigue.
 */
export function accesoFunnelEnabled(): boolean {
  return process.env.ACCESO_FUNNEL_ENABLED === "1";
}

export async function recordAccesoStep(
  step: AccesoFunnelStep,
  rawOrigin: string | null | undefined,
  role: string | null = null,
): Promise<void> {
  if (!accesoFunnelEnabled()) return;
  const origin = normalizeAccesoOrigin(rawOrigin);
  const roleKey = step === "carrera" || step === "enviado" ? (role ?? "") : "";
  try {
    await assertAppRole();
    await getAppDb().transaction(async (tx) => {
      // Contar es accesorio: si la base tarda, se corta rápido
      await tx.execute(sql`set local statement_timeout = '2s'`);
      await tx.execute(sql`select public.acceso_funnel_hit(${origin}, ${step}, ${roleKey})`);
    });
  } catch (e) {
    createLogger({ task: "acceso_funnel" }).warn(
      { err: safeDbError(e), step },
      "embudo de /acceso: no se pudo contar",
    );
  }
}

export type AccesoFunnelResult =
  | { ok: true; rows: AccesoFunnelRow[] }
  | { ok: false; reason: "no_admin" | "no_habilitado" | "apagado" | "sin_datos" };

/** Filas de los últimos `days` días para /settings/metricas. Mismas dos barreras que las métricas. */
export async function getAccesoFunnel(userId: string, days = 30): Promise<AccesoFunnelResult> {
  if (!(await canCreateInvitations(userId))) return { ok: false, reason: "no_admin" };
  if (!accesoFunnelEnabled()) return { ok: false, reason: "apagado" };
  try {
    const raw = (await withUser(userId, (tx) =>
      tx.execute(sql`select hour, origin, step, role, count from acceso_funnel_admin(${days})`),
    )) as unknown as unknown[];
    const rows = parseAccesoFunnelRows(Array.from(raw));
    return rows ? { ok: true, rows } : { ok: false, reason: "sin_datos" };
  } catch (error) {
    for (let e: unknown = error; e && typeof e === "object"; e = (e as { cause?: unknown }).cause) {
      const message = (e as { message?: unknown }).message;
      if (typeof message === "string" && message.includes("acceso_funnel_admin: no autorizado")) {
        return { ok: false, reason: "no_habilitado" };
      }
    }
    return { ok: false, reason: "sin_datos" };
  }
}
