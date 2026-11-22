import type { ThinkingLevel } from "./types";

/**
 * Qué parámetros opcionales acepta cada modelo. Es una tabla sobre los modelos (qué sabe hacer
 * cada uno), no sobre el ruteo: qué modelo usa cada tarea sigue saliendo solo de `model_routing`.
 */
export type ModelCapabilities = {
  /** Acepta `temperature`. Algunos modelos de Anthropic la rechazan y el SDK avisa. */
  temperature: boolean;
  /** Acepta el parámetro de razonamiento (`thinking_level`). Solo Google. */
  thinking: boolean;
  /** Razonamiento que se usa cuando el modelo entra de respaldo y la fila no define uno. */
  fallbackThinking: ThinkingLevel | null;
  /** Acepta imágenes en el mensaje del usuario. */
  images: boolean;
};

/** Modelo que no está en la tabla: no se le manda ningún parámetro opcional y no recibe imágenes. */
export const UNKNOWN_MODEL_CAPABILITIES: ModelCapabilities = {
  temperature: false,
  thinking: false,
  fallbackThinking: null,
  images: false,
};

const GEMINI: ModelCapabilities = {
  temperature: true,
  thinking: true,
  fallbackThinking: "minimal",
  images: true,
};

const CAPABILITIES: Record<string, ModelCapabilities> = {
  "gemini-3.5-flash": GEMINI,
  "gemini-3.1-flash-lite": GEMINI,
  // Anthropic acepta el razonamiento ("none" manda thinking disabled), pero las filas con principal
  // Anthropic llevan null: sin valor no se manda nada y manda el default de la API.
  "claude-haiku-4-5": { temperature: true, thinking: true, fallbackThinking: null, images: true },
  "claude-haiku-5-5": { temperature: false, thinking: true, fallbackThinking: null, images: true },
  "claude-sonnet-5-5": {
    temperature: false,
    thinking: true,
    fallbackThinking: null,
    images: true,
  },
};

export function capabilitiesFor(model: string): ModelCapabilities {
  return Object.hasOwn(CAPABILITIES, model) ? CAPABILITIES[model]! : UNKNOWN_MODEL_CAPABILITIES;
}

/**
 * Razonamiento a mandar: el de la fila solo si el modelo lo acepta. Si el modelo entra de
 * respaldo y la fila no define uno, usa el de la tabla (la fila describe al principal).
 */
export function reasoningFor(
  model: string,
  routeThinking: ThinkingLevel | null,
  isFallback: boolean,
): ThinkingLevel | undefined {
  const caps = capabilitiesFor(model);
  if (!caps.thinking) return undefined;
  return routeThinking ?? (isFallback ? (caps.fallbackThinking ?? undefined) : undefined);
}
