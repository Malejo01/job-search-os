import type { Result } from "@job-search-os/pipeline";
import type { PromptRef } from "@job-search-os/prompts";
import type { LanguageModel } from "ai";
import type { z } from "zod";

export const THINKING_LEVELS = ["none", "minimal", "low", "medium", "high"] as const;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

/** Fila de `model_routing` ya resuelta para una tarea. */
export type RouteConfig = {
  task: string;
  provider: string;
  model: string;
  fallbackModel: string | null;
  temperature: number;
  maxTokens: number;
  /** Razonamiento extendido (vocabulario del AI SDK); null = default del proveedor. */
  thinkingLevel: ThinkingLevel | null;
  /** USD por millón de tokens del modelo primario; null = desconocido (cost_usd queda null). */
  inputUsdPerMtok: number | null;
  outputUsdPerMtok: number | null;
  /** Idem para fallback_model. */
  fallbackInputUsdPerMtok: number | null;
  fallbackOutputUsdPerMtok: number | null;
};

export interface RouteSource {
  getRoute(task: string): Promise<RouteConfig | null>;
}

/** Fila de `llm_calls`. */
export type LlmCallRecord = {
  userId: string | null;
  task: string;
  model: string;
  promptVersion: string;
  jobId: string | null;
  tokensIn: number | null;
  /** Salida facturada: texto + thinking. */
  tokensOut: number | null;
  /** Parte de tokensOut que fue thinking/razonamiento (null si el proveedor no lo informa). */
  tokensReasoning: number | null;
  latencyMs: number;
  costUsd: number | null;
  /** Etiqueta de la corrida (evals: --label); null en operación. */
  label: string | null;
  ok: boolean;
  error: string | null;
};

export interface CallSink {
  record(call: LlmCallRecord): Promise<void>;
}

/** Fábrica de modelos del AI SDK por proveedor; null si falta la API key. */
export interface ProviderRegistry {
  modelFor(provider: string, model: string): LanguageModel | null;
}

export type GenerateContext = {
  userId?: string;
  jobId?: string;
  /** Por defecto: DEFAULT_PROMPT_VERSIONS[task] o `${task}@v1`. */
  promptVersion?: PromptRef;
  /** Cancela la llamada en curso (SIGINT/SIGTERM, timeout duro de la corrida). */
  signal?: AbortSignal;
  /** Con qué `task` se registra en llm_calls (evals: `eval:<prompt_version>`); default: la tarea ruteada. */
  recordTask?: string;
  /** Etiqueta de la corrida para llm_calls.label (evals: --label). */
  label?: string;
};

export type GenerateUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
};

export type GenerateResult<T> = {
  object: T;
  model: string;
  provider: string;
  promptVersion: string;
  usage: GenerateUsage;
  costUsd: number | null;
  latencyMs: number;
  usedFallback: boolean;
};

export type LlmError = {
  kind: "no_route" | "prompt" | "provider_unavailable" | "generation_failed" | "aborted";
  task: string;
  detail: string;
};

export interface LlmClient {
  generateStructured<T>(
    task: string,
    schema: z.ZodType<T>,
    vars: Record<string, string | number | boolean>,
    ctx?: GenerateContext,
  ): Promise<Result<GenerateResult<T>, LlmError>>;
}

/** Firma mínima de `generateObject` del AI SDK, inyectable para tests. */
export type GenerateFn = (args: {
  model: LanguageModel;
  schema: z.ZodType<unknown>;
  prompt: string;
  temperature: number;
  maxOutputTokens: number;
  abortSignal?: AbortSignal;
  /** Razonamiento extendido unificado del AI SDK (Gemini 3.x → thinkingLevel; 2.5 → thinkingBudget). */
  reasoning?: ThinkingLevel;
}) => Promise<{
  object: unknown;
  usage: {
    inputTokens?: number | undefined;
    outputTokens?: number | undefined;
    /** Tokens de thinking incluidos en outputTokens (Gemini `thoughtsTokenCount`, Anthropic thinking). */
    reasoningTokens?: number | undefined;
  };
  /** true si el proveedor ya validó contra el schema (el objeto trae los transforms aplicados). */
  validated?: boolean;
}>;
