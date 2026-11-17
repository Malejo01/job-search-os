import {
  cvCoachAllowed,
  cvCoachMode,
  profileAgentAccess,
  type ProfileAgentAccess,
} from "@job-search-os/pipeline";
import { getSessionEmail } from "@/lib/profile-agent/access";

/**
 * La puerta del coach de CV en la app (ADR-038 §10). La usan las páginas `/cv/coach/**`, el botón de entrada
 * y las rutas `/api/cv-coach/*`. El flag lo decide `cvCoachAllowed` (pipeline: `CV_COACH` más el agente de
 * perfil encendido para la misma persona); el orden sesión → flag → ticket → tope es el de
 * `profileAgentAccess` (ADR-034 O7).
 */

/** ¿Esta persona ve el coach? Sin el flag no se consulta la base; ante un error, no lo ve (falla cerrado). */
export async function cvCoachAllowedFor(userId: string): Promise<boolean> {
  if (cvCoachMode(process.env) === "off") return false;
  try {
    return cvCoachAllowed(process.env, await getSessionEmail(userId));
  } catch {
    return false;
  }
}

/** Sesión (401) → flag (404), para las rutas. El ticket y el tope los comprueba la ruta después. */
export function requireCvCoach(
  sessionUserId: () => Promise<string | null>,
): Promise<ProfileAgentAccess> {
  return profileAgentAccess({ session: sessionUserId, flag: cvCoachAllowedFor });
}
