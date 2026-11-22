import { randomBytes } from "node:crypto";
import { createLogger } from "@job-search-os/adapters";
import { schema as s } from "@job-search-os/db";
import {
  formatInboundAddress,
  INBOUND_TOKEN_BYTES,
  isLegacyInboundAddress,
  tokenFromBytes,
} from "@job-search-os/pipeline";
import { eq, sql } from "drizzle-orm";
import { withUser } from "./db";

/**
 * Dirección de email entrante del usuario (JS-095). Es un secreto: quien la conozca puede meter
 * emails en la cuenta, así que nunca va a un log.
 */

export type AssignResult = { ok: true; address: string } | { ok: false; reason: "sin_dominio" };

function isUniqueViolation(error: unknown): boolean {
  for (let e: unknown = error; e && typeof e === "object"; e = (e as { cause?: unknown }).cause) {
    if ((e as { code?: unknown }).code === "23505") return true;
  }
  return false;
}

export async function getInboundAddress(userId: string): Promise<string | null> {
  const [row] = await withUser(userId, (tx) =>
    tx
      .select({ address: s.profiles.inboundAddress })
      .from(s.profiles)
      .where(eq(s.profiles.userId, userId))
      .limit(1),
  );
  return row?.address ?? null;
}

/**
 * La dirección y, si una rotación dejó la anterior como alias que todavía vale, hasta cuándo. Es la
 * misma consulta del perfil que ya hacía /inbox: el aviso «tu dirección cambió» no suma otra.
 */
export async function getInboundAddressState(
  userId: string,
  now: Date = new Date(),
): Promise<{ address: string; graceUntil: Date | null } | null> {
  const [row] = await withUser(userId, (tx) =>
    tx
      .select({
        address: s.profiles.inboundAddress,
        previousUntil: s.profiles.previousInboundUntil,
      })
      .from(s.profiles)
      .where(eq(s.profiles.userId, userId))
      .limit(1),
  );
  if (!row) return null;
  return {
    address: row.address,
    graceUntil: row.previousUntil && row.previousUntil > now ? row.previousUntil : null,
  };
}

/**
 * Deja de recibir en la dirección anterior de una rotación. La app no escribe esas columnas: lo hace una
 * función de la base que solo mira la sesión (`app.user_id`), así que la persona solo toca la suya.
 * Devuelve true si había un alias que revocar.
 */
export async function revokePreviousInboundAddress(userId: string): Promise<boolean> {
  const rows = (await withUser(userId, (tx) =>
    tx.execute(sql`select public.revoke_previous_inbound_address() as ok`),
  )) as unknown as { ok: boolean }[];
  const revoked = rows[0]?.ok === true;
  if (revoked) {
    createLogger({ user_id: userId, task: "inbound_address" }).info("dirección anterior revocada");
  }
  return revoked;
}

/**
 * Reemplaza la dirección por una aleatoria de 100 bits. Si choca con el unique reintenta una vez.
 * Sin INGEST_DOMAIN no inventa un dominio: devuelve `sin_dominio`.
 */
export async function assignRandomInboundAddress(userId: string): Promise<AssignResult> {
  const domain = process.env.INGEST_DOMAIN?.trim();
  if (!domain) {
    createLogger({ user_id: userId, task: "inbound_address" }).warn("falta INGEST_DOMAIN");
    return { ok: false, reason: "sin_dominio" };
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    const address = formatInboundAddress(tokenFromBytes(randomBytes(INBOUND_TOKEN_BYTES)), domain);
    try {
      const updated = await withUser(userId, (tx) =>
        tx
          .update(s.profiles)
          .set({ inboundAddress: address, updatedAt: new Date() })
          .where(eq(s.profiles.userId, userId))
          .returning({ userId: s.profiles.userId }),
      );
      if (updated.length === 0) throw new Error("el usuario no tiene perfil");
      createLogger({ user_id: userId, task: "inbound_address" }).info("dirección asignada");
      return { ok: true, address };
    } catch (error) {
      if (!isUniqueViolation(error) || attempt === 1) throw error;
    }
  }
  throw new Error("inalcanzable");
}

/**
 * Al completar el onboarding: si la dirección es la derivada del id se cambia por una aleatoria;
 * si ya es aleatoria no se toca (un doble envío no rota). Sin dominio, queda la actual.
 */
export async function upgradeLegacyInboundAddress(userId: string): Promise<boolean> {
  const current = await getInboundAddress(userId);
  if (!current || !isLegacyInboundAddress(current, userId)) return false;
  const result = await assignRandomInboundAddress(userId);
  return result.ok;
}
