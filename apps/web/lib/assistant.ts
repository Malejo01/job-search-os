import { schema as s } from "@job-search-os/db";
import { assistantAllowed, assistantMode } from "@job-search-os/pipeline";
import { eq } from "drizzle-orm";
import { withUser } from "./db";
import { testerEnvFor } from "./user-roles";

/**
 * ¿Esta persona ve y usa el asistente (AG-3)? Con `ASSISTANT_ENABLED=admin`, solo `ADMIN_EMAILS`; con
 * `testers`, también `ASSISTANT_TESTER_EMAILS` y quien tenga el rol tester en la base (panel /admin). Sin el flag no hay consulta; si la consulta falla, falla cerrado (no lo ve).
 */
export async function canUseAssistant(userId: string): Promise<boolean> {
  if (assistantMode(process.env) === "off") return false;
  try {
    const [me] = await withUser(userId, (tx) =>
      tx.select({ email: s.users.email }).from(s.users).where(eq(s.users.id, userId)).limit(1),
    );
    // Tester por la base (ADM-1): solo hace falta mirarlo en la etapa `testers`
    const env =
      assistantMode(process.env) === "testers"
        ? await testerEnvFor(userId, me?.email)
        : process.env;
    return assistantAllowed(env, me?.email);
  } catch {
    return false;
  }
}
