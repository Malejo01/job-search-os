/**
 * Encendido de la transcripción de voz en el servidor (R25-03). Puro: la app lee el entorno y el email de la
 * sesión y los pasa. Es la única función que parsea `VOICE_SERVER_TRANSCRIBE`.
 *
 * - `testers`: `ADMIN_EMAILS` y `ASSISTANT_TESTER_EMAILS` (la misma lista del agente de perfil).
 * - `all`: toda persona con sesión.
 * - Cualquier otro valor (vacío, «off», «1», «true», mal escrito) es apagado: falla cerrado.
 *
 * Apagado, los navegadores sin dictado propio muestran un mensaje en vez del botón.
 */
import { isProfileAgentTester } from "../profile-agent/flag";

export type VoiceServerMode = "off" | "testers" | "all";

export function voiceServerMode(env: Record<string, string | undefined>): VoiceServerMode {
  const v = env.VOICE_SERVER_TRANSCRIBE?.trim().toLowerCase();
  return v === "testers" || v === "all" ? v : "off";
}

/** ¿Esta persona puede transcribir en el servidor? */
export function voiceServerAllowed(
  env: Record<string, string | undefined>,
  email: string | null | undefined,
): boolean {
  const mode = voiceServerMode(env);
  if (mode === "off") return false;
  if (mode === "all") return true;
  return isProfileAgentTester(env, email);
}
