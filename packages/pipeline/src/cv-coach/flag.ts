/**
 * Encendido del coach de CV (ADR-038 §10). Puro: la app lee el entorno y el email de la sesión y los pasa.
 * Es la única función que parsea `CV_COACH`; la usan /cv, las páginas `/cv/coach/**` y las rutas
 * `/api/cv-coach/*`.
 *
 * - `CV_COACH=testers`: `ADMIN_EMAILS` y `ASSISTANT_TESTER_EMAILS` (la misma lista que el agente de perfil).
 * - `CV_COACH=all`: toda persona con sesión.
 * - Cualquier otro valor (vacío, «apagado», «off», «1», mal escrito) es apagado.
 * - Además exige que el agente de perfil esté encendido para la misma persona (`profileAgentAllowed`): el
 *   coach usa su lectura, su ticket y sus topes.
 */
import { isProfileAgentTester, profileAgentAllowed } from "../profile-agent/flag";

export type CvCoachMode = "off" | "testers" | "all";

export function cvCoachMode(env: Record<string, string | undefined>): CvCoachMode {
  const v = env.CV_COACH?.trim().toLowerCase();
  return v === "testers" || v === "all" ? v : "off";
}

/** ¿Esta persona ve el coach? Falla cerrado ante un flag mal escrito o sin el agente de perfil. */
export function cvCoachAllowed(
  env: Record<string, string | undefined>,
  email: string | null | undefined,
): boolean {
  if (!profileAgentAllowed(env, email)) return false;
  const mode = cvCoachMode(env);
  if (mode === "off") return false;
  if (mode === "all") return true;
  return isProfileAgentTester(env, email);
}
