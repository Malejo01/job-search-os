import { createLogger } from "@job-search-os/adapters";
import { resolveConversationLimits, type ConversationLimits } from "@job-search-os/pipeline";

/**
 * Topes de la charla del asistente, leídos en el borde: `ASSISTANT_MAX_USD_PER_CONVERSATION`
 * (default 0,50) y `ASSISTANT_MAX_TURNS` (default 20). La validación es de pipeline (Zod); acá solo
 * se lee el entorno y se loguea. Una variable inválida usa el default y avisa una sola vez por
 * proceso (no en cada mensaje). Nunca lanza: una mala configuración no tumba al asistente.
 */
const ENV_NAME = {
  maxUsd: "ASSISTANT_MAX_USD_PER_CONVERSATION",
  maxTurns: "ASSISTANT_MAX_TURNS",
} as const;

const warned = new Set<string>();

export function assistantLimits(
  env: Record<string, string | undefined> = process.env,
): ConversationLimits {
  const { limits, invalid } = resolveConversationLimits({
    maxTurns: env[ENV_NAME.maxTurns],
    maxUsd: env[ENV_NAME.maxUsd],
  });
  for (const key of invalid) {
    if (warned.has(key)) continue;
    warned.add(key);
    createLogger({ task: "assistant_limits" }).warn(
      {
        variable: ENV_NAME[key],
        default_used:
          key === "maxUsd" ? limits.maxUsdPerConversation : limits.maxTurnsPerConversation,
      },
      "asistente: variable de tope inválida, se usa el valor por defecto",
    );
  }
  return limits;
}
