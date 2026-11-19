import { randomBytes } from "node:crypto";
import { schema as s, type Db } from "@job-search-os/db";
import {
  formatInboundAddress,
  INBOUND_TOKEN_BYTES,
  isLegacyInboundAddress,
  tokenFromBytes,
} from "@job-search-os/pipeline";
import { and, eq } from "drizzle-orm";

/**
 * Reemplaza las direcciones de ingesta derivadas del id por direcciones aleatorias. Se corre una sola
 * vez. Quien ya reenvía correo a la dirección vieja tiene que actualizar su filtro: por eso, sin
 * `apply`, solo cuenta. El resultado trae conteos: las direcciones son secretos y no se imprimen.
 */
export const ROTATE_INBOUND_PHRASE = "rotar direcciones";

export type RotateInboundResult = {
  scanned: number;
  legacy: number;
  rotated: number;
  failed: number;
};

export function parseRotateInboundArgs(
  argv: string[],
): { ok: true; apply: boolean; remote: boolean } | { ok: false; error: string } {
  const unknown = argv.filter((a) => a !== "--apply" && a !== "--remote");
  if (unknown.length > 0) return { ok: false, error: "uso: [--apply] [--remote]" };
  return { ok: true, apply: argv.includes("--apply"), remote: argv.includes("--remote") };
}

function isUniqueViolation(error: unknown): boolean {
  for (let e: unknown = error; e && typeof e === "object"; e = (e as { cause?: unknown }).cause) {
    if ((e as { code?: unknown }).code === "23505") return true;
  }
  return false;
}

/** Cambia la dirección solo si sigue siendo la leída. Si choca con otra, prueba una vez más. */
async function rotateOne(db: Db, userId: string, current: string): Promise<boolean> {
  const domain = current.slice(current.lastIndexOf("@") + 1);
  for (let attempt = 0; attempt < 2; attempt++) {
    const next = formatInboundAddress(tokenFromBytes(randomBytes(INBOUND_TOKEN_BYTES)), domain);
    try {
      const updated = await db
        .update(s.profiles)
        .set({ inboundAddress: next, updatedAt: new Date() })
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
  options: { apply: boolean },
): Promise<RotateInboundResult> {
  const rows = await db
    .select({ userId: s.profiles.userId, address: s.profiles.inboundAddress })
    .from(s.profiles);
  const legacy = rows.filter((r) => isLegacyInboundAddress(r.address, r.userId));
  const result: RotateInboundResult = {
    scanned: rows.length,
    legacy: legacy.length,
    rotated: 0,
    failed: 0,
  };
  if (!options.apply) return result;
  for (const row of legacy) {
    if (await rotateOne(db, row.userId, row.address)) result.rotated++;
    else result.failed++;
  }
  return result;
}
