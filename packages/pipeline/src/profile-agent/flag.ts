/**
 * Encendido del agente de perfil desde el CV (ADR-034). Puro: la app lee el entorno y el email de la
 * sesión y los pasa. Es la única función que parsea `CV_PROFILE_AGENT`; la usan /cv, el onboarding y las
 * rutas del agente.
 *
 * - `CV_PROFILE_AGENT=testers`: `ADMIN_EMAILS` y `ASSISTANT_TESTER_EMAILS` (sin dar permisos de admin).
 * - `CV_PROFILE_AGENT=all`: toda persona con sesión.
 * - Cualquier otro valor (vacío, «apagado», «off», «1», «Testers » mal escrito) es apagado.
 * - Además hace falta `CV_IMPORT_ENABLED=1` (la lectura de CV, ADR-008): sin ella el agente no tiene
 *   etapa de lectura y todo queda apagado.
 */
import { isAdminEmail } from "../agent/gate";

export type ProfileAgentMode = "off" | "testers" | "all";

export function profileAgentMode(env: Record<string, string | undefined>): ProfileAgentMode {
  const v = env.CV_PROFILE_AGENT?.trim().toLowerCase();
  return v === "testers" || v === "all" ? v : "off";
}

/** Misma lista que usa el asistente para sus testers: `ADMIN_EMAILS` más `ASSISTANT_TESTER_EMAILS`. */
export function isProfileAgentTester(
  env: Record<string, string | undefined>,
  email: string | null | undefined,
): boolean {
  return isAdminEmail(email, env.ADMIN_EMAILS) || isAdminEmail(email, env.ASSISTANT_TESTER_EMAILS);
}

/** ¿Esta persona ve el agente? Falla cerrado ante un flag mal escrito o sin `CV_IMPORT_ENABLED=1`. */
export function profileAgentAllowed(
  env: Record<string, string | undefined>,
  email: string | null | undefined,
): boolean {
  if (env.CV_IMPORT_ENABLED !== "1") return false;
  const mode = profileAgentMode(env);
  if (mode === "off") return false;
  if (mode === "all") return true;
  return isProfileAgentTester(env, email);
}

/**
 * Sin tope de lecturas por mes (decisión 5): `ADMIN_EMAILS` y `ASSISTANT_TESTER_EMAILS`, con el flag que
 * sea. Los topes de USD (por charla, por día y global) rigen igual para todos.
 */
export function profileAgentQuotaExempt(
  env: Record<string, string | undefined>,
  email: string | null | undefined,
): boolean {
  return isProfileAgentTester(env, email);
}
