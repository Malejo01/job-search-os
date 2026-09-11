import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModel } from "ai";
import type { ProviderRegistry } from "./types";

export type ProviderEnv = {
  GEMINI_API_KEY?: string | undefined;
  ANTHROPIC_API_KEY?: string | undefined;
};

/**
 * Proveedores soportados por `model_routing.provider`. Un proveedor sin API key
 * devuelve null: el cliente lo reporta como no disponible en vez de fallar a ciegas.
 */
export function createProviderRegistry(
  env: ProviderEnv = process.env as ProviderEnv,
): ProviderRegistry {
  const google = env.GEMINI_API_KEY
    ? createGoogleGenerativeAI({ apiKey: env.GEMINI_API_KEY })
    : null;
  const anthropic = env.ANTHROPIC_API_KEY
    ? createAnthropic({ apiKey: env.ANTHROPIC_API_KEY })
    : null;

  return {
    modelFor(provider: string, model: string): LanguageModel | null {
      switch (provider) {
        case "google":
          return google ? google(model) : null;
        case "anthropic":
          return anthropic ? anthropic(model) : null;
        default:
          return null;
      }
    },
  };
}

/** El fallback puede ser de otro proveedor: se infiere por el prefijo del nombre. */
export function providerForModel(model: string, defaultProvider: string): string {
  if (model.startsWith("gemini")) return "google";
  if (model.startsWith("claude")) return "anthropic";
  return defaultProvider;
}
