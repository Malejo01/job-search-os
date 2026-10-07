import { createLogger } from "@job-search-os/adapters";
import { confirmsAccountDeletion, deleteUserData, schema as s } from "@job-search-os/db";
import { eq } from "drizzle-orm";
import { withUser } from "./db";

export type DeleteAccountResult =
  { ok: true; counts: Record<string, number> } | { ok: false; reason: "mismatch" };

/**
 * Borra la cuenta del usuario de la sesión (JS-092). Pide el email de la cuenta y la contraseña:
 * si alguno no coincide no se toca nada y el error es el mismo para los dos (no dice cuál falló).
 * El borrado corre en UNA transacción como el usuario (RLS acota cada DELETE a sus filas) y
 * termina en `users`; si algo falla, se deshace todo. Los conteos van al log con `user_id`, sin datos.
 */
export async function deleteAccount(
  userId: string,
  input: { email: string; password: string },
): Promise<DeleteAccountResult> {
  const counts = await withUser(userId, async (tx) => {
    const [user] = await tx
      .select({ email: s.users.email, passwordHash: s.users.passwordHash })
      .from(s.users)
      .where(eq(s.users.id, userId))
      .limit(1);
    if (!confirmsAccountDeletion(user, input)) return null;
    return deleteUserData(tx, userId);
  });
  if (!counts) return { ok: false, reason: "mismatch" };
  createLogger({ user_id: userId, task: "delete_account" }).info({ counts }, "cuenta eliminada");
  return { ok: true, counts };
}
