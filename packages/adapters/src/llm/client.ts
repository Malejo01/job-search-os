import { err, ok, type Result } from "@job-search-os/pipeline";
import { loadPrompt, renderPrompt, type PromptRef } from "@job-search-os/prompts";
import { generateObject } from "ai";
import type { z } from "zod";
import { createLogger, type Logger } from "../logger";
import { LlmValidationError, llmErrorDetail, normalizeLlmError } from "./error-code";
import { providerForModel } from "./providers";
import type {
  CallSink,
  GenerateContext,
  GenerateFn,
  GenerateResult,
  LlmClient,
  LlmError,
  ProviderRegistry,
  RouteConfig,
  RouteSource,
} from "./types";

/**
 * Versión de prompt vigente por tarea. Cambiarla es una decisión de Mauro
 * (playbook, Prompt C), no un efecto colateral de otro ticket. Se promueve con 3 corridas
 * contra 3 de la vigente y las tolerancias de promoción (v1.3.4: 2026-10-07, JS-074).
 */
export const DEFAULT_PROMPT_VERSIONS: Record<string, PromptRef> = {
  evaluate_job: "evaluate_job@v1.3.4",
  draft_application_answers: "draft_application_answers@v1",
};

/**
 * Timeout duro por llamada. Una evaluación tarda 5–15 s; si pasa de esto el proveedor está
 * colgado y esperar solo acumula procesos vivos. Se puede subir con LLM_CALL_TIMEOUT_MS.
 */
export const DEFAULT_CALL_TIMEOUT_MS = 90_000;

export type LlmClientDeps = {
  routes: RouteSource;
  calls: CallSink;
  providers: ProviderRegistry;
  logger?: Logger;
  /** Inyectable en tests; por defecto `generateObject` del AI SDK. */
  generate?: GenerateFn;
  now?: () => number;
  /** Timeout por llamada (ms). Default: LLM_CALL_TIMEOUT_MS o DEFAULT_CALL_TIMEOUT_MS. */
  callTimeoutMs?: number;
};

const defaultGenerate: GenerateFn = async (args) => {
  const result = await generateObject({
    model: args.model,
    schema: args.schema,
    prompt: args.prompt,
    temperature: args.temperature,
    maxOutputTokens: args.maxOutputTokens,
    maxRetries: 2,
    abortSignal: args.abortSignal,
    ...(args.reasoning ? { reasoning: args.reasoning } : {}),
  });
  // generateObject ya validó (y aplicó transforms del schema): no re-parsear
  return {
    object: result.object,
    usage: {
      inputTokens: result.usage.inputTokens,
      // outputTokens del SDK ya incluye el thinking (Gemini: candidates + thoughts)
      outputTokens: result.usage.outputTokens,
      reasoningTokens: result.usage.outputTokenDetails?.reasoningTokens,
    },
    validated: true,
  };
};

/** Costo estimado con las tarifas de model_routing; null si falta tarifa o tokens. */
export function estimateCost(
  route: RouteConfig,
  model: string,
  tokensIn: number | null,
  tokensOut: number | null,
): number | null {
  const [inPrice, outPrice] =
    model === route.model
      ? [route.inputUsdPerMtok, route.outputUsdPerMtok]
      : model === route.fallbackModel
        ? [route.fallbackInputUsdPerMtok, route.fallbackOutputUsdPerMtok]
        : [null, null];
  if (inPrice === null || outPrice === null) return null;
  if (tokensIn === null || tokensOut === null) return null;
  return (tokensIn * inPrice + tokensOut * outPrice) / 1_000_000;
}

const isAbort = (e: unknown, signal: AbortSignal): boolean =>
  signal.aborted || (e instanceof Error && e.name === "AbortError");

function resolveTimeout(deps: LlmClientDeps): number {
  if (deps.callTimeoutMs !== undefined) return deps.callTimeoutMs;
  const fromEnv = Number(process.env.LLM_CALL_TIMEOUT_MS);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : DEFAULT_CALL_TIMEOUT_MS;
}

export function createLlmClient(deps: LlmClientDeps): LlmClient {
  const logger = deps.logger ?? createLogger();
  const generate = deps.generate ?? defaultGenerate;
  const now = deps.now ?? Date.now;
  const timeoutMs = resolveTimeout(deps);

  async function attempt<T>(
    route: RouteConfig,
    provider: string,
    model: string,
    schema: z.ZodType<T>,
    prompt: string,
    promptVersion: string,
    ctx: GenerateContext,
    log: Logger,
  ): Promise<Result<GenerateResult<T>, LlmError>> {
    const languageModel = deps.providers.modelFor(provider, model);
    if (!languageModel) {
      log.warn({ provider, model }, "proveedor sin API key: modelo no disponible");
      return err({
        kind: "provider_unavailable",
        task: route.task,
        detail: "provider_unavailable",
      });
    }
    if (ctx.signal?.aborted) {
      return err({ kind: "aborted", task: route.task, detail: "aborted" });
    }

    // Timeout duro por llamada + cancelación externa (SIGINT/SIGTERM, tope de corrida)
    const signal = ctx.signal
      ? AbortSignal.any([ctx.signal, AbortSignal.timeout(timeoutMs)])
      : AbortSignal.timeout(timeoutMs);

    const startedAt = now();
    try {
      const raw = await generate({
        model: languageModel,
        schema,
        prompt,
        temperature: route.temperature,
        maxOutputTokens: route.maxTokens,
        abortSignal: signal,
        reasoning: route.thinkingLevel ?? undefined,
      });
      const latencyMs = now() - startedAt;
      // Si el proveedor ya validó, el objeto es la SALIDA del schema (con transforms aplicados)
      // y volver a parsearlo con el mismo schema fallaría; solo se valida lo no validado (tests).
      const parsed = raw.validated
        ? { success: true as const, data: raw.object as T }
        : schema.safeParse(raw.object);
      if (!parsed.success) {
        throw new LlmValidationError(parsed.error.issues);
      }
      const tokensIn = raw.usage.inputTokens ?? null;
      const tokensOut = raw.usage.outputTokens ?? null;
      const tokensReasoning = raw.usage.reasoningTokens ?? null;
      const costUsd = estimateCost(route, model, tokensIn, tokensOut);
      await deps.calls.record({
        userId: ctx.userId ?? null,
        task: ctx.recordTask ?? route.task,
        model,
        promptVersion,
        jobId: ctx.jobId ?? null,
        tokensIn,
        tokensOut,
        tokensReasoning,
        latencyMs,
        costUsd,
        label: ctx.label ?? null,
        ok: true,
        error: null,
      });
      log.info(
        {
          model,
          latency_ms: latencyMs,
          tokens_in: tokensIn,
          tokens_out: tokensOut,
          tokens_reasoning: tokensReasoning,
          cost_usd: costUsd,
          thinking: route.thinkingLevel,
        },
        "llm ok",
      );
      return ok({
        object: parsed.data,
        model,
        provider,
        promptVersion,
        usage: { inputTokens: tokensIn, outputTokens: tokensOut, reasoningTokens: tokensReasoning },
        costUsd,
        latencyMs,
        usedFallback: model !== route.model,
      });
    } catch (e) {
      const latencyMs = now() - startedAt;
      const aborted = isAbort(e, signal);
      // Solo el código cerrado (D-027): nunca `e.message`, que puede citar el JD o la salida
      const code = aborted ? (ctx.signal?.aborted ? "aborted" : "timeout") : normalizeLlmError(e);
      // `detail` lleva además un sufijo fijo para el clasificador de evals; la base, solo el código
      const detail = llmErrorDetail(code);
      await deps.calls.record({
        userId: ctx.userId ?? null,
        task: ctx.recordTask ?? route.task,
        model,
        promptVersion,
        jobId: ctx.jobId ?? null,
        tokensIn: null,
        tokensOut: null,
        tokensReasoning: null,
        latencyMs,
        costUsd: null,
        label: ctx.label ?? null,
        ok: false,
        error: code.slice(0, 120),
      });
      log.error(
        { model, latency_ms: latencyMs, err: code, err_name: e instanceof Error ? e.name : null },
        "llm falló",
      );
      return err({ kind: aborted ? "aborted" : "generation_failed", task: route.task, detail });
    }
  }

  return {
    async generateStructured(task, schema, vars, ctx = {}) {
      const log = logger.child({ task, user_id: ctx.userId, job_id: ctx.jobId });

      const route = await deps.routes.getRoute(task);
      if (!route) {
        log.error("tarea sin fila en model_routing");
        return err({ kind: "no_route", task, detail: `sin fila en model_routing para '${task}'` });
      }

      const promptVersion = ctx.promptVersion ?? DEFAULT_PROMPT_VERSIONS[task] ?? `${task}@v1`;
      const loaded = loadPrompt(promptVersion);
      if (!loaded.ok) {
        return err({ kind: "prompt", task, detail: JSON.stringify(loaded.error) });
      }
      const rendered = renderPrompt(loaded.value, vars);
      if (!rendered.ok) {
        return err({ kind: "prompt", task, detail: JSON.stringify(rendered.error) });
      }

      const primary = await attempt(
        route,
        route.provider,
        route.model,
        schema,
        rendered.value,
        promptVersion,
        ctx,
        log,
      );
      // Cancelación externa: no tiene sentido (ni presupuesto) probar el fallback
      if (primary.ok || !route.fallbackModel || ctx.signal?.aborted) return primary;

      log.warn({ from: route.model, to: route.fallbackModel }, "usando fallback_model");
      const fallback = await attempt(
        route,
        providerForModel(route.fallbackModel, route.provider),
        route.fallbackModel,
        schema,
        rendered.value,
        promptVersion,
        ctx,
        log,
      );
      // Si el fallback tampoco está disponible, el error útil es el del primario
      return fallback.ok || fallback.error.kind !== "provider_unavailable" ? fallback : primary;
    },
  };
}
