import { markAllResetTokensUsed } from "@job-search-os/adapters";
import { schema as s } from "@job-search-os/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import { withUser } from "./db";

/**
 * Cierra todos los accesos de la cuenta, en una sola transacción: sube la versión de sesión (cada JWT emitido
 * antes deja de valer en el próximo pedido, `currentSession` lo compara con la base), revoca los tokens
 * personales del asistente externo y marca como usados los links de recuperación pendientes.
 */
export async function closeAllSessions(userId: string): Promise<void> {
  const now = new Date();
  await withUser(userId, async (tx) => {
    await tx
      .update(s.users)
      .set({ sessionVersion: sql`${s.users.sessionVersion} + 1`, updatedAt: now })
      .where(eq(s.users.id, userId));
    await tx
      .update(s.mcpTokens)
      .set({ revokedAt: now })
      .where(and(eq(s.mcpTokens.userId, userId), isNull(s.mcpTokens.revokedAt)));
    await markAllResetTokensUsed(tx, userId, now);
  });
}
