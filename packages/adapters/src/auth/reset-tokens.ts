import { schema as s, type Db } from "@job-search-os/db";
import { and, eq, gt, isNull } from "drizzle-orm";

/**
 * Consume UN token de forma atómica (S-3, C-5 seguridad S-11): `UPDATE … WHERE used_at IS NULL AND
 * expires_at > now RETURNING`. Si dos pedidos llegan con el mismo link, el segundo espera el lock de
 * la fila y no encuentra nada que actualizar. Devuelve el user_id, o null si el token no sirve.
 */
export async function consumeResetToken(
  tx: Pick<Db, "update">,
  tokenHash: string,
  now: Date,
): Promise<string | null> {
  const [row] = await tx
    .update(s.passwordResetTokens)
    .set({ usedAt: now })
    .where(
      and(
        eq(s.passwordResetTokens.tokenHash, tokenHash),
        isNull(s.passwordResetTokens.usedAt),
        gt(s.passwordResetTokens.expiresAt, now),
      ),
    )
    .returning({ userId: s.passwordResetTokens.userId });
  return row?.userId ?? null;
}

/**
 * Marca como usados todos los tokens de recuperación del usuario (SEC-05). Se llama dentro de la
 * misma transacción que cambia la contraseña, así un link viejo no sobrevive al reset.
 */
export async function markAllResetTokensUsed(
  tx: Pick<Db, "update">,
  userId: string,
  now: Date,
): Promise<void> {
  await tx
    .update(s.passwordResetTokens)
    .set({ usedAt: now })
    .where(eq(s.passwordResetTokens.userId, userId));
}
