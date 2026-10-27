import {
  addCost,
  AGENT_LIMITS,
  checkStep,
  estimateTokens,
  maxStepCostUsd,
  type AgentCapReason,
} from "@job-search-os/pipeline";
import { isStepCount, streamText, tool, type LanguageModel, type ModelMessage } from "ai";
import type { z } from "zod";
import { createLogger, type Logger } from "../logger";
import { estimateCost } from "./client";
import { normalizeLlmError } from "./error-code";
import type { CallSink, LlmCallRecord, ProviderRegistry, RouteConfig, RouteSource } from "./types";

/**
 * Bucle del asistente (Fase 7, etapa 3, AG-1): un turno de charla con tools, paso a paso, con los
 * topes de `packages/pipeline/src/agent/limits.ts`. El modelo sale de `model_routing` (tarea
 * `assistant_chat`); sin fila, falla cerrado. Las tools NUNCA escriben: leen o devuelven una
 * propuesta que la persona confirma en la pantalla (eso lo arma la app).
 *
 * El bucle es propio (un `streamText` de un paso por vuelta) y no el multi-paso del SDK: así cada
 * paso se controla ANTES de llamar (tokens de entrada, peor caso en USD) y se registra en
 * `llm_calls` uno por uno. Lo que se registra no lleva contenido: tokens, costo, latencia, código
 * de error y la etiqueta de la conversación (`conv:<id>`).
 */

export const ASSISTANT_TASK = "assistant_chat";
/** Deadline propio del turno entero (las funciones de Vercel cortan a los 60 s). */
export const AGENT_DEADLINE_MS = 50_000;

export type AgentToolCall = { id: string; name: string; input: unknown };
/** `output` es el texto que ve el modelo (la app envuelve con wrapUntrusted lo que viene de afuera). */
export type AgentToolResult = { id: string; name: string; output: string; isError: boolean };

/** Mensajes propios y no `ModelMessage` del SDK: la app y el fake no dependen del SDK. */
export type AgentChatMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: AgentToolCall[] }
  | { role: "tool"; results: AgentToolResult[] };

export type AgentTool = {
  description: string;
  inputSchema: z.ZodType<unknown>;
  /** NUNCA escribe (regla única del asistente): lee o devuelve una propuesta. */
  execute: (input: unknown, opts: { signal: AbortSignal }) => Promise<unknown>;
  /** Texto del resultado para el modelo; por defecto, JSON. */
  toModelText?: (output: unknown) => string;
};

/** Partes mínimas que consume el bucle; la implementación por defecto adapta `streamText`. */
export type AgentStreamPart =
  | { type: "text-delta"; text: string }
  | { type: "tool-call"; toolCallId: string; toolName: string; input: unknown }
  | {
      type: "finish";
      usage: { inputTokens?: number; outputTokens?: number; reasoningTokens?: number };
    }
  | { type: "error"; error: unknown };

export type AgentStreamFn = (args: {
  model: LanguageModel;
  system: string;
  messages: AgentChatMessage[];
  /** Definiciones sin `execute`: el SDK devuelve los tool calls y no ejecuta nada. */
  tools: Record<string, { description: string; inputSchema: z.ZodType<unknown> }>;
  activeTools: string[];
  maxOutputTokens: number;
  temperature: number;
  abortSignal: AbortSignal;
}) => AsyncIterable<AgentStreamPart>;

export type AgentErrorCode =
  "no_route" | "provider_unavailable" | "timeout" | "aborted" | "generation_failed";

export type AgentEvent =
  /** Delta de texto para la UI. */
  | { type: "text"; text: string }
  /** Resultado de una tool: la app saca de acá las propuestas. */
  | { type: "tool"; name: string; input: unknown; output: unknown; isError: boolean }
  | {
      type: "step";
      step: number;
      tokensIn: number | null;
      tokensOut: number | null;
      costUsd: number | null;
    }
  | { type: "cap"; reason: AgentCapReason }
  | { type: "error"; code: AgentErrorCode }
  | { type: "done"; steps: number; costUsd: number | null };

export type StreamAgentInput = {
  system: string;
  messages: AgentChatMessage[];
  tools: Record<string, AgentTool>;
  signal?: AbortSignal;
  /** Tools activas en cada paso (la app usa `activeToolsFor`). Por defecto, todas. */
  activeTools?: (step: number, state: { proposalsSoFar: number }) => string[];
  /** Qué tools son propuestas, para contarlas. */
  isProposal?: (toolName: string) => boolean;
  /** Gasto de turnos anteriores de esta conversación; null = desconocido → no sigue. */
  spentUsd: number | null;
  /** Versión del prompt de sistema; solo se registra (el prompt lo arma la app). */
  promptVersion: string;
};

export type StreamAgentDeps = {
  routes: RouteSource;
  calls: CallSink;
  providers: ProviderRegistry;
  /** Inyectable en tests y en el modo demo; por defecto, `streamText` del SDK. */
  streamFn?: AgentStreamFn;
  logger?: Logger;
  now?: () => number;
  /** Deadline del turno (ms); por defecto AGENT_DEADLINE_MS. */
  deadlineMs?: number;
};

export type StreamAgentCtx = {
  userId: string;
  /** Etiqueta de la conversación en llm_calls: `conv:<id aleatorio>`. */
  label: string;
};

function toModelMessages(messages: AgentChatMessage[]): ModelMessage[] {
  return messages.map((m): ModelMessage => {
    if (m.role === "user") return { role: "user", content: m.content };
    if (m.role === "assistant") {
      return {
        role: "assistant",
        content: [
          ...(m.content ? [{ type: "text" as const, text: m.content }] : []),
          ...(m.toolCalls ?? []).map((c) => ({
            type: "tool-call" as const,
            toolCallId: c.id,
            toolName: c.name,
            input: c.input,
          })),
        ],
      };
    }
    return {
      role: "tool",
      content: m.results.map((r) => ({
        type: "tool-result" as const,
        toolCallId: r.id,
        toolName: r.name,
        output: { type: "text" as const, value: r.output },
      })),
    };
  });
}

/** `streamText` del SDK, un paso, sin reintentos y sin ejecutar tools. */
export const defaultAgentStreamFn: AgentStreamFn = async function* (args) {
  const result = streamText({
    model: args.model,
    system: args.system,
    messages: toModelMessages(args.messages),
    tools: Object.fromEntries(
      Object.entries(args.tools).map(([name, t]) => [
        name,
        tool({ description: t.description, inputSchema: t.inputSchema }),
      ]),
    ),
    activeTools: args.activeTools,
    stopWhen: isStepCount(1),
    maxRetries: 0,
    maxOutputTokens: args.maxOutputTokens,
    temperature: args.temperature,
    abortSignal: args.abortSignal,
  });
  for await (const part of result.fullStream) {
    if (part.type === "text-delta") yield { type: "text-delta", text: part.text };
    else if (part.type === "tool-call") {
      yield {
        type: "tool-call",
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        input: part.input,
      };
    } else if (part.type === "finish") {
      yield {
        type: "finish",
        usage: {
          inputTokens: part.totalUsage.inputTokens,
          outputTokens: part.totalUsage.outputTokens,
          reasoningTokens: part.totalUsage.outputTokenDetails?.reasoningTokens,
        },
      };
    } else if (part.type === "error") yield { type: "error", error: part.error };
  }
};

class AbortedError extends Error {
  constructor() {
    super("aborted");
    this.name = "AbortError";
  }
}

/** Siguiente parte del stream o corte por abort, aunque el proveedor ignore la señal. */
function nextOrAbort<T>(it: AsyncIterator<T>, signal: AbortSignal): Promise<IteratorResult<T>> {
  if (signal.aborted) return Promise.reject(new AbortedError());
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new AbortedError());
    signal.addEventListener("abort", onAbort, { once: true });
    it.next().then(
      (r) => {
        signal.removeEventListener("abort", onAbort);
        resolve(r);
      },
      (e: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(e);
      },
    );
  });
}

const toolError = (code: string) => ({ error: code });

export async function* streamAgent(
  task: string,
  input: StreamAgentInput,
  ctx: StreamAgentCtx,
  deps: StreamAgentDeps,
): AsyncGenerator<AgentEvent> {
  const log = (deps.logger ?? createLogger()).child({
    task,
    user_id: ctx.userId,
    run_id: ctx.label,
  });
  const now = deps.now ?? Date.now;
  const streamFn = deps.streamFn ?? defaultAgentStreamFn;

  const record = (route: RouteConfig, partial: Partial<LlmCallRecord>) =>
    deps.calls.record({
      userId: ctx.userId,
      task,
      model: route.model,
      promptVersion: input.promptVersion,
      jobId: null,
      tokensIn: null,
      tokensOut: null,
      tokensReasoning: null,
      latencyMs: 0,
      costUsd: null,
      label: ctx.label,
      ok: false,
      error: null,
      ...partial,
    });

  const route = await deps.routes.getRoute(task);
  if (!route) {
    log.error(`sin fila en model_routing para '${task}'`);
    yield { type: "error", code: "no_route" };
    return;
  }
  const model = deps.providers.modelFor(route.provider, route.model);
  if (!model) {
    log.warn({ provider: route.provider, model: route.model }, "proveedor sin API key");
    await record(route, { error: "provider_unavailable" });
    yield { type: "error", code: "provider_unavailable" };
    return;
  }

  const deadline = AbortSignal.timeout(deps.deadlineMs ?? AGENT_DEADLINE_MS);
  const signal = input.signal ? AbortSignal.any([input.signal, deadline]) : deadline;
  const stopCode = (): "aborted" | "timeout" => (input.signal?.aborted ? "aborted" : "timeout");

  const rates = {
    inputUsdPerMtok: route.inputUsdPerMtok,
    outputUsdPerMtok: route.outputUsdPerMtok,
  };
  const maxOutputTokens = Math.min(route.maxTokens, AGENT_LIMITS.maxOutputTokensPerStep);
  const toolDefs = Object.fromEntries(
    Object.entries(input.tools).map(([name, t]) => [
      name,
      { description: t.description, inputSchema: t.inputSchema },
    ]),
  );
  const messages = [...input.messages];
  let spent = input.spentUsd;
  let proposals = 0;

  for (let step = 0; ; step++) {
    if (signal.aborted) {
      yield { type: "error", code: stopCode() };
      return;
    }
    const active = (
      input.activeTools?.(step, { proposalsSoFar: proposals }) ?? Object.keys(input.tools)
    ).filter((name) => name in input.tools);
    // Estimación conservadora de lo que entra: sistema, historial y las tools que se ofrecen
    const estimate = estimateTokens(
      input.system +
        JSON.stringify(messages) +
        JSON.stringify(active.map((n) => [n, input.tools[n]!.description])),
    );
    const cap = checkStep(step, estimate, spent, maxStepCostUsd(rates, estimate));
    if (!cap.ok) {
      log.info({ step, reason: cap.error }, "asistente: tope");
      yield { type: "cap", reason: cap.error };
      return;
    }

    const startedAt = now();
    let text = "";
    const toolCalls: AgentToolCall[] = [];
    let usage: { inputTokens?: number; outputTokens?: number; reasoningTokens?: number } = {};
    try {
      const it = streamFn({
        model,
        system: input.system,
        messages,
        tools: toolDefs,
        activeTools: active,
        maxOutputTokens,
        temperature: route.temperature,
        abortSignal: signal,
      })[Symbol.asyncIterator]();
      try {
        for (;;) {
          const r = await nextOrAbort(it, signal);
          if (r.done) break;
          const part = r.value;
          if (part.type === "text-delta") {
            text += part.text;
            yield { type: "text", text: part.text };
          } else if (part.type === "tool-call") {
            toolCalls.push({ id: part.toolCallId, name: part.toolName, input: part.input });
          } else if (part.type === "finish") {
            usage = part.usage;
          } else if (part.type === "error") {
            throw part.error;
          }
        }
      } finally {
        // Un proveedor colgado puede no cerrar nunca: no se espera
        void Promise.resolve(it.return?.()).catch(() => undefined);
      }
    } catch (e) {
      const latencyMs = now() - startedAt;
      const stopped = signal.aborted || (e instanceof Error && e.name === "AbortError");
      const code = stopped ? stopCode() : normalizeLlmError(e);
      await record(route, { latencyMs, error: code.slice(0, 120) });
      log.error(
        { step, latency_ms: latencyMs, err: code, err_name: e instanceof Error ? e.name : null },
        "asistente: falló el paso",
      );
      yield { type: "error", code: stopped ? stopCode() : "generation_failed" };
      return;
    }

    const latencyMs = now() - startedAt;
    const tokensIn = usage.inputTokens ?? null;
    const tokensOut = usage.outputTokens ?? null;
    const costUsd = estimateCost(route, route.model, tokensIn, tokensOut);
    spent = addCost(spent, costUsd);
    await record(route, {
      tokensIn,
      tokensOut,
      tokensReasoning: usage.reasoningTokens ?? null,
      latencyMs,
      costUsd,
      ok: true,
    });
    log.info(
      {
        step,
        tokens_in: tokensIn,
        tokens_out: tokensOut,
        cost_usd: costUsd,
        latency_ms: latencyMs,
        tool_calls: toolCalls.length,
      },
      "asistente: paso",
    );
    yield { type: "step", step, tokensIn, tokensOut, costUsd };

    if (toolCalls.length === 0) {
      yield { type: "done", steps: step + 1, costUsd: spent };
      return;
    }

    const results: AgentToolResult[] = [];
    for (const call of toolCalls) {
      const t = active.includes(call.name) ? input.tools[call.name] : undefined;
      let output: unknown;
      let isError = true;
      if (!t) {
        output = toolError("tool_no_disponible");
      } else {
        const parsed = t.inputSchema.safeParse(call.input);
        if (!parsed.success) {
          // Sin eco del input: puede traer texto de la persona o de un aviso
          output = toolError("entrada_invalida");
        } else {
          try {
            output = await t.execute(parsed.data, { signal });
            isError = false;
          } catch (e) {
            log.warn(
              { step, tool: call.name, err_name: e instanceof Error ? e.name : null },
              "asistente: tool falló",
            );
            output = toolError("tool_fallo");
          }
        }
      }
      if (!isError && input.isProposal?.(call.name)) proposals++;
      yield { type: "tool", name: call.name, input: call.input, output, isError };
      const modelText =
        !isError && t?.toModelText ? t.toModelText(output) : JSON.stringify(output ?? null);
      results.push({ id: call.id, name: call.name, output: modelText, isError });
    }
    messages.push({ role: "assistant", content: text, toolCalls });
    messages.push({ role: "tool", results });
  }
}
