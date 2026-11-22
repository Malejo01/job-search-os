import { schema as s } from "@job-search-os/db";
import { eq } from "drizzle-orm";
import { mayReviewAcademy } from "./academy";
import { withUser } from "./db";

/**
 * ¿Esta persona revisa los borradores de Academy? Admins (`ADMIN_EMAILS`) y testers
 * (`ASSISTANT_TESTER_EMAILS`), mirado en el servidor con la sesión. Falla cerrado: si la consulta
 * rompe, no.
 */
export async function canReviewAcademy(userId: string): Promise<boolean> {
  try {
    const [me] = await withUser(userId, (tx) =>
      tx.select({ email: s.users.email }).from(s.users).where(eq(s.users.id, userId)).limit(1),
    );
    return mayReviewAcademy(me?.email, process.env);
  } catch {
    return false;
  }
}
