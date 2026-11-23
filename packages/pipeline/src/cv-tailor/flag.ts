/**
 * Encendido de la versión del CV adaptada con IA (R20-04). Puro: la app lee el entorno y el email de la sesión y
 * los pasa. Es la única función que parsea `CV_TAILOR`.
 *
 * - `CV_TAILOR=testers`: `ADMIN_EMAILS` y `ASSISTANT_TESTER_EMAILS` (la misma lista del agente de perfil).
 * - `CV_TAILOR=all`: toda persona con sesión.
 * - Cualquier otro valor (vacío, «off», «1», «true», mal escrito) es apagado: falla cerrado.
 */
import { isProfileAgentTester } from "../profile-agent/flag";

export type CvTailorMode = "off" | "testers" | "all";

export function cvTailorMode(env: Record<string, string | undefined>): CvTailorMode {
  const v = env.CV_TAILOR?.trim().toLowerCase();
  return v === "testers" || v === "all" ? v : "off";
}

/** ¿Esta persona puede pedir la versión adaptada con IA? */
export function cvTailorAllowed(
  env: Record<string, string | undefined>,
  email: string | null | undefined,
): boolean {
  const mode = cvTailorMode(env);
  if (mode === "off") return false;
  if (mode === "all") return true;
  return isProfileAgentTester(env, email);
}
