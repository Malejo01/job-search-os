/**
 * Una sola puerta del agente de perfil (ADR-034 §7 y §9, O7). Antes cada etapa tenía su propia lectura del
 * flag (`profileAgentEnabledFor`, `profileAgentAllowedFor` x2) y el orden de los chequeos dependía de cómo
 * lo escribiera cada ruta. Acá queda en un solo lugar y con test:
 *
 *   1. sesión  (sin sesión: 401, sin tocar la base ni el modelo)
 *   2. flag    (apagado: 404, como una ruta que no existe)
 *   3. ticket  (inválido o vencido: 409)
 *   4. tope    (alcanzado: 429, mensaje fijo)
 *
 * Es puro: las comprobaciones llegan inyectadas, así que el módulo no hace I/O. Cada una se corre solo si la
 * anterior pasó; una que lanza una excepción cierra en su etapa (nunca abre).
 */
import { profileAgentAllowed, profileAgentMode } from "./flag";

export type ProfileAgentAccessStage = "session" | "flag" | "ticket" | "cap";

const STATUS: Record<ProfileAgentAccessStage, 401 | 404 | 409 | 429> = {
  session: 401,
  flag: 404,
  ticket: 409,
  cap: 429,
};

type Check<T> = () => T | Promise<T>;

export type ProfileAgentAccessChecks = {
  /** Id de la persona de la sesión, o `null` si no hay. */
  session: Check<string | null>;
  /** ¿Ve el agente? Recibe el id de la sesión. */
  flag: (userId: string) => boolean | Promise<boolean>;
  /** ¿El ticket es válido? Solo las rutas que lo exigen. */
  ticket?: (userId: string) => boolean | Promise<boolean>;
  /** ¿Pasa los topes (`true` = hay lugar)? Solo las rutas que llaman al modelo. */
  cap?: (userId: string) => boolean | Promise<boolean>;
};

export type ProfileAgentAccess =
  | { ok: true; userId: string }
  | { ok: false; stage: ProfileAgentAccessStage; status: 401 | 404 | 409 | 429 };

export async function profileAgentAccess(
  checks: ProfileAgentAccessChecks,
): Promise<ProfileAgentAccess> {
  const deny = (stage: ProfileAgentAccessStage): ProfileAgentAccess => ({
    ok: false,
    stage,
    status: STATUS[stage],
  });
  let userId: string | null;
  try {
    userId = await checks.session();
  } catch {
    return deny("session");
  }
  if (!userId) return deny("session");
  const steps = [
    ["flag", checks.flag],
    ["ticket", checks.ticket],
    ["cap", checks.cap],
  ] as const;
  for (const [stage, check] of steps) {
    if (!check) continue;
    let pass: boolean;
    try {
      pass = await check(userId);
    } catch {
      pass = false;
    }
    if (!pass) return deny(stage);
  }
  return { ok: true, userId };
}

/**
 * ¿Esta persona ve el agente? `CV_PROFILE_AGENT` (`testers` | `all`) más `CV_IMPORT_ENABLED=1`. Es la
 * única lectura del flag que usa la app. Sin el flag (o sin `CV_IMPORT_ENABLED=1`) no se consulta el email;
 * si la consulta falla o no hay email, `testers` cierra.
 */
export async function profileAgentFlagFor(
  env: Record<string, string | undefined>,
  getEmail: () => Promise<string | null | undefined>,
): Promise<boolean> {
  if (env.CV_IMPORT_ENABLED !== "1" || profileAgentMode(env) === "off") return false;
  try {
    return profileAgentAllowed(env, await getEmail());
  } catch {
    return false;
  }
}
