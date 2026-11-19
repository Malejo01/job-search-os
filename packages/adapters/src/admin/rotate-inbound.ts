import { randomBytes } from "node:crypto";
import { schema as s, type Db } from "@job-search-os/db";
import {
  formatInboundAddress,
  INBOUND_TOKEN_BYTES,
  isLegacyInboundAddress,
  tokenFromBytes,
} from "@job-search-os/pipeline";
import { and, eq, gte, inArray, sql } from "drizzle-orm";

/**
 * Reemplaza las direcciones de ingesta derivadas del id por direcciones aleatorias. Se corre una sola
 * vez. Quien ya reenvía correo a la dirección vieja tiene que actualizar su filtro: por eso, sin
 * `apply`, solo cuenta. El resultado trae conteos: las direcciones son secretos y no se imprimen.
 */
export const ROTATE_INBOUND_PHRASE = "rotar direcciones";

export type RotateInboundResult = {
  scanned: number;
  legacy: number;
  /** Cuentas con dirección vieja que recibieron correo en los últimos 30 días (las que se cortarían sin gracia). */
  affected: number;
  rotated: number;
  failed: number;
};

/** Días que la dirección vieja sigue resolviendo como alias después de rotar. */
export const DEFAULT_GRACE_DAYS = 7;
const MAX_GRACE_DAYS = 90;
/** Ventana para contar las cuentas que reciben correo en la dirección vieja. */
const RECENT_MAIL_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

const USAGE = "uso: [--apply] [--remote] [--grace-days=N]";

export function parseRotateInboundArgs(
  argv: string[],
): { ok: true; apply: boolean; remote: boolean; graceDays: number } | { ok: false; error: string } {
  let graceDays = DEFAULT_GRACE_DAYS;
  for (const arg of argv) {
    if (arg === "--apply" || arg === "--remote") continue;
    const grace = /^--grace-days=(\d+)$/.exec(arg)?.[1];
    const n = grace === undefined ? NaN : Number(grace);
    if (!Number.isInteger(n) || n < 1 || n > MAX_GRACE_DAYS) return { ok: false, error: USAGE };
    graceDays = n;
  }
  return {
    ok: true,
    apply: argv.includes("--apply"),
    remote: argv.includes("--remote"),
    graceDays,
  };
}

function isUniqueViolation(error: unknown): boolean {
  for (let e: unknown = error; e && typeof e === "object"; e = (e as { cause?: unknown }).cause) {
    if ((e as { code?: unknown }).code === "23505") return true;
  }
  return false;
}

/**
 * Cambia la dirección solo si sigue siendo la leída. La vieja queda como alias hasta `graceUntil`. Si
 * choca con otra, prueba una vez más.
 */
async function rotateOne(
  db: Db,
  userId: string,
  current: string,
  graceUntil: Date,
  now: Date,
): Promise<boolean> {
  const domain = current.slice(current.lastIndexOf("@") + 1);
  for (let attempt = 0; attempt < 2; attempt++) {
    const next = formatInboundAddress(tokenFromBytes(randomBytes(INBOUND_TOKEN_BYTES)), domain);
    try {
      const updated = await db
        .update(s.profiles)
        .set({
          inboundAddress: next,
          previousInboundAddress: current.toLowerCase(),
          previousInboundUntil: graceUntil,
          updatedAt: now,
        })
        .where(and(eq(s.profiles.userId, userId), eq(s.profiles.inboundAddress, current)))
        .returning({ userId: s.profiles.userId });
      return updated.length === 1;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
  }
  return false;
}

export async function rotateLegacyInboundAddresses(
  db: Db,
  options: { apply: boolean; now?: Date; graceDays?: number },
): Promise<RotateInboundResult> {
  const now = options.now ?? new Date();
  const graceUntil = new Date(now.getTime() + (options.graceDays ?? DEFAULT_GRACE_DAYS) * DAY_MS);
  const rows = await db
    .select({ userId: s.profiles.userId, address: s.profiles.inboundAddress })
    .from(s.profiles);
  const legacy = rows.filter((r) => isLegacyInboundAddress(r.address, r.userId));

  // Cuentas con dirección vieja que recibieron correo en los últimos 30 días (índice user_id, received_at)
  let affected = 0;
  if (legacy.length > 0) {
    const since = new Date(now.getTime() - RECENT_MAIL_DAYS * DAY_MS);
    const [row] = await db
      .select({ n: sql<number>`count(distinct ${s.inboundEmails.userId})::int` })
      .from(s.inboundEmails)
      .where(
        and(
          inArray(
            s.inboundEmails.userId,
            legacy.map((r) => r.userId),
          ),
          gte(s.inboundEmails.receivedAt, since),
        ),
      );
    affected = row?.n ?? 0;
  }

  const result: RotateInboundResult = {
    scanned: rows.length,
    legacy: legacy.length,
    affected,
    rotated: 0,
    failed: 0,
  };
  if (!options.apply) return result;
  for (const row of legacy) {
    if (await rotateOne(db, row.userId, row.address, graceUntil, now)) result.rotated++;
    else result.failed++;
  }
  return result;
}
