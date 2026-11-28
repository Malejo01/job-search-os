/**
 * Encendido de la ficha del aviso (R31, plan §8). Mismo patrón que `cv-coach/flag.ts`. Puro: la app lee el
 * entorno y el email de la sesión y los pasa. Es la única función que parsea `JOB_CARD`.
 *
 * - `JOB_CARD=testers`: admins y testers (la misma lista que el agente de perfil, `isProfileAgentTester`).
 * - `JOB_CARD=all`: toda persona con sesión.
 * - Cualquier otro valor (vacío, «apagado», «off», «1», mal escrito) es apagado: la app se ve y se comporta
 *   igual que al cerrar la R30.
 */
import { isProfileAgentTester } from "../profile-agent/flag";

export type JobCardMode = "off" | "testers" | "all";

export function jobCardMode(env: Record<string, string | undefined>): JobCardMode {
  const v = env.JOB_CARD?.trim().toLowerCase();
  return v === "testers" || v === "all" ? v : "off";
}

/** ¿Esta persona ve la ficha? Falla cerrado ante un flag mal escrito. */
export function jobCardAllowed(
  env: Record<string, string | undefined>,
  email: string | null | undefined,
): boolean {
  const mode = jobCardMode(env);
  if (mode === "off") return false;
  if (mode === "all") return true;
  return isProfileAgentTester(env, email);
}

/**
 * ¿Hay alguien con la ficha encendida? Para el ingreso y el worker, que generan la ficha una sola vez por
 * hash sin contexto de persona: con la variable apagada no se genera ni se gasta nada.
 */
export function jobCardGenerationEnabled(env: Record<string, string | undefined>): boolean {
  return jobCardMode(env) !== "off";
}
