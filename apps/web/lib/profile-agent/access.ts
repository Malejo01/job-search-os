import { schema as s } from "@job-search-os/db";
import {
  profileAgentAccess,
  profileAgentFlagFor,
  profileAgentMode,
  type ProfileAgentAccess,
} from "@job-search-os/pipeline";
import { eq } from "drizzle-orm";
import { withUser } from "@/lib/db";
import { testerEnvFor } from "@/lib/user-roles";

/**
 * La única puerta del agente de perfil en la app (ADR-034 §7 y §9). La usan las páginas, la tarjeta de `/cv`,
 * el onboarding y cada endpoint `/api/cv-perfil/*`. El orden (sesión → flag → ticket → tope) y la lectura del
 * flag viven en el pipeline (`profileAgentAccess`, `profileAgentFlagFor`, con test); acá solo se conectan a la
 * sesión y a la base.
 */

/** Email de la sesión, con RLS (decide el flag `testers` y las exenciones de cupo). `null` si no se puede leer. */
export async function getSessionEmail(userId: string): Promise<string | null> {
  try {
    const [me] = await withUser(userId, (tx) =>
      tx.select({ email: s.users.email }).from(s.users).where(eq(s.users.id, userId)).limit(1),
    );
    return me?.email ?? null;
  } catch {
    return null;
  }
}

/**
 * ¿Esta persona ve el agente? Para las páginas, que ya resolvieron la sesión. Sin el flag no se consulta la
 * base; ante un error de la consulta, no lo ve (falla cerrado).
 */
export async function profileAgentAllowedFor(userId: string): Promise<boolean> {
  if (process.env.CV_IMPORT_ENABLED !== "1" || profileAgentMode(process.env) === "off")
    return false;
  // Tester por la base (ADM-1): solo cambia algo en la etapa `testers`
  if (profileAgentMode(process.env) !== "testers") {
    return profileAgentFlagFor(process.env, () => getSessionEmail(userId));
  }
  const email = await getSessionEmail(userId);
  return profileAgentFlagFor(await testerEnvFor(userId, email), async () => email);
}

/**
 * Sesión → flag, para los endpoints. Devuelve el estado a responder (401 sin sesión, 404 con el flag apagado)
 * o el id de la persona. El ticket y el tope los comprueba la ruta después, en ese orden.
 */
export function requireProfileAgent(
  sessionUserId: () => Promise<string | null>,
): Promise<ProfileAgentAccess> {
  return profileAgentAccess({ session: sessionUserId, flag: profileAgentAllowedFor });
}
