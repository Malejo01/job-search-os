import { schema as s } from "@job-search-os/db";
import { assistantAllowed, assistantMode } from "@job-search-os/pipeline";
import { eq } from "drizzle-orm";
import { withUser } from "./db";

/**
 * ¿Esta persona ve y usa el asistente (AG-3)? Solo con `ASSISTANT_ENABLED=admin` y su email en
 * `ADMIN_EMAILS`. Sin el flag no hay consulta; si la consulta falla, falla cerrado (no lo ve).
 */
export async function canUseAssistant(userId: string): Promise<boolean> {
  if (assistantMode(process.env) !== "admin") return false;
  try {
    const [me] = await withUser(userId, (tx) =>
      tx.select({ email: s.users.email }).from(s.users).where(eq(s.users.id, userId)).limit(1),
    );
    return assistantAllowed(process.env, me?.email);
  } catch {
    return false;
  }
}
