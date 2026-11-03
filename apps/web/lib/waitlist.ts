import { createLogger } from "@job-search-os/adapters";
import type { WaitlistData } from "@job-search-os/pipeline";
import { sql } from "drizzle-orm";
import { createHash, createHmac } from "node:crypto";
import { assertAppRole, getAppDb } from "./db";

/**
 * Lista de espera pública (ronda 63), solo servidor. Sin sesión: la app no puede leer ni escribir la
 * tabla `waitlist` directo, entra por waitlist_join (packages/db/rls/0006_waitlist.sql), que
 * normaliza el email, evita duplicados y aplica el tope por IP. Nunca se loguea la IP ni el email.
 */

export type WaitlistStatus = "ok" | "duplicate" | "rate_limited";

const UNKNOWN_IP = "unknown";

/**
 * HMAC-SHA256 de la IP con pepper (WAITLIST_PEPPER o, si no, AUTH_SECRET). Nunca devuelve null: el
 * límite por IP no se saltea. Sin IP se usa el bucket fijo "unknown"; sin pepper no se hashea la IP
 * real (sin sal se podría invertir) y todos caen en el hash sin pepper de "unknown".
 */
export function hashIp(ip: string | null): string {
  const pepper = process.env.WAITLIST_PEPPER || process.env.AUTH_SECRET;
  if (!pepper) {
    createLogger({ task: "waitlist_join" }).warn(
      "lista de espera: falta WAITLIST_PEPPER/AUTH_SECRET, el límite por IP se aplica en conjunto",
    );
    return createHash("sha256").update(UNKNOWN_IP).digest("hex");
  }
  return createHmac("sha256", pepper)
    .update(ip || UNKNOWN_IP)
    .digest("hex");
}

/** ¿El error es que `waitlist_join_event` todavía no existe en la base (rls/0006 sin re-aplicar)? */
function isMissingEventFunction(error: unknown): boolean {
  for (let e: unknown = error; e && typeof e === "object"; e = (e as { cause?: unknown }).cause) {
    const message = (e as { message?: unknown }).message;
    if (typeof message === "string" && /waitlist_join_event.*does not exist/.test(message)) {
      return true;
    }
  }
  return false;
}

/**
 * Anota en la lista. Con `event` (C8-3: `?origen=voces-jovenes` dentro de WAITLIST_EVENT_WINDOW) usa
 * `waitlist_join_event`, con topes más altos para el wifi compartido del salón; si la base todavía no
 * la tiene, cae a los topes normales.
 */
export async function joinWaitlist(
  input: WaitlistData,
  ip: string | null,
  opts: { event?: boolean } = {},
): Promise<WaitlistStatus> {
  await assertAppRole();
  const ipHash = hashIp(ip);
  const run = (event: boolean) =>
    // Tope de 8 s: si la base se cuelga, el pedido falla con el mensaje genérico en vez de quedar colgado
    getAppDb().transaction(async (tx) => {
      await tx.execute(sql`set local statement_timeout = '8s'`);
      return event
        ? tx.execute(
            sql`select public.waitlist_join_event(${input.name}, ${input.email}, ${input.role}, ${input.heardFrom}, ${ipHash}) as status`,
          )
        : tx.execute(
            sql`select public.waitlist_join(${input.name}, ${input.email}, ${input.role}, ${input.heardFrom}, ${ipHash}) as status`,
          );
    });
  let result: unknown;
  try {
    result = await run(opts.event === true);
  } catch (e) {
    if (!(opts.event && isMissingEventFunction(e))) throw e;
    createLogger({ task: "waitlist_join" }).warn(
      "lista de espera: falta waitlist_join_event (rls/0006), uso los topes normales",
    );
    result = await run(false);
  }
  const rows = result as { status: string }[];
  const status = rows[0]?.status;
  if (status !== "ok" && status !== "duplicate" && status !== "rate_limited") {
    throw new Error("waitlist_join devolvió un estado inesperado");
  }
  return status;
}
