import { schema as s } from "@job-search-os/db";
import { eq, sql } from "drizzle-orm";
import { withUser } from "./db";

/**
 * Cierra todas las sesiones de la cuenta: sube la versión de sesión y cada JWT emitido antes deja de
 * valer en el próximo pedido (`currentSession` lo compara con la base).
 */
export async function closeAllSessions(userId: string): Promise<void> {
  await withUser(userId, (tx) =>
    tx
      .update(s.users)
      .set({ sessionVersion: sql`${s.users.sessionVersion} + 1`, updatedAt: new Date() })
      .where(eq(s.users.id, userId)),
  );
}
