import { withDbTesters } from "@job-search-os/pipeline";
import { sql } from "drizzle-orm";
import { withUser } from "./db";

/**
 * Roles que se dan desde el panel /admin (ADM-1, `user_roles`, rls/0064). Hoy solo `tester`: suma a la
 * persona a las etapas «testers» igual que `ASSISTANT_TESTER_EMAILS`, sin tocar Vercel.
 *
 * Falla cerrado hacia «sin roles»: si la consulta rompe (por ejemplo, la función todavía no está aplicada
 * en la base), la persona queda como antes, con lo que digan las variables de entorno.
 */
export async function myRoles(userId: string): Promise<string[]> {
  try {
    const rows = (await withUser(userId, (tx) =>
      tx.execute(sql`select my_roles() as r`),
    )) as unknown as { r: string[] | null }[];
    const r = rows[0]?.r;
    return Array.isArray(r) ? r : [];
  } catch {
    return [];
  }
}

/**
 * El env con el que deciden las etapas «testers»: `process.env` más el email de la persona si tiene el rol
 * `tester` en la base. Solo para la decisión de esta persona; nunca toca `ADMIN_EMAILS`.
 */
export async function testerEnvFor(
  userId: string,
  email: string | null | undefined,
): Promise<NodeJS.ProcessEnv> {
  if (!email) return process.env;
  return withDbTesters(process.env, email, await myRoles(userId));
}
