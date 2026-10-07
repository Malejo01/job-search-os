import { schema as s, type Db } from "@job-search-os/db";
import { eq } from "drizzle-orm";

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
