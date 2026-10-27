import {
  addCost,
  AGENT_LIMITS,
  checkStep,
  estimateTokens,
  isProposalTool,
  maxStepCostUsd,
  type AgentCapReason,
} from "@job-search-os/pipeline";
import {
  isStepCount,
  streamText,
  tool,
  type LanguageModel,
  type ModelMessage,
  type ProviderMetadata,
} from "ai";
import { z } from "zod";
import { createLogger, type Logger } from "../logger";
import { estimateCost } from "./client";
import { normalizeLlmError } from "./error-code";
import type {
  CallSink,
  LlmCallRecord,
  ProviderRegistry,
  RouteConfig,
  RouteSource,
  ThinkingLevel,
} from "./types";

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
 *
 * Costo registrado por paso: con `usage` real, el costo real; si el paso falló o se cortó DESPUÉS
 * de llamar al proveedor y no hay `usage`, el peor caso del paso (entrada estimada + salida
 * máxima), así la suma por conversación nunca subestima. Un corte ANTES de llamar no registra fila.
 * `streamAgent` nunca lanza salvo por un error de programación del llamador (label o versión de
 * prompt mal formados), que se valida al empezar.
 */

export const ASSISTANT_TASK = "assistant_chat";
/** Deadline propio del turno entero (las funciones de Vercel cortan a los 60 s). */
export const AGENT_DEADLINE_MS = 50_000;
/** Tool calls por paso; las que sobran vuelven con error sin ejecutarse. */
export const MAX_TOOL_CALLS_PER_STEP = 4;

const LABEL_RE = /^conv:[A-Za-z0-9_-]{6,64}$/;
const PROMPT_VERSION_RE = /^[a-z_]+@[A-Za-z0-9._-]{1,32}$/;

export type AgentToolCall = {
  id: string;
  name: string;
  input: unknown;
  /** Metadatos del proveedor (p. ej. la firma de razonamiento de Gemini): vuelven tal cual. */
  providerMetadata?: ProviderMetadata;
};
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
  | {
      type: "tool-call";
      toolCallId: string;
      toolName: string;
      input: unknown;
      providerMetadata?: ProviderMetadata;
    }
  | {
      type: "finish";
      usage: { inputTokens?: number; outputTokens?: number; reasoningTokens?: number };
      finishReason?: string;
    }
  | { type: "abort" }
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
  /** Razonamiento extendido de la fila de `model_routing` (como client.ts). */
  reasoning?: ThinkingLevel;
  abortSignal: AbortSignal;
}) => AsyncIterable<AgentStreamPart>;

export type AgentErrorCode =
  "no_route" | "provider_unavailable" | "timeout" | "aborted" | "generation_failed";

/**
 * Eventos del turno. `input` y `output` de las tools pueden traer datos del perfil o de un aviso:
 * la app los usa para armar la tarjeta y NO los loguea ni los persiste.
 */
export type AgentEvent =
  /** Delta de texto para la UI. */
  | { type: "text"; text: string }
  /**
   * Resultado de una tool: la app saca de acá las propuestas. `input` es la entrada ya validada
   * (null si no validó); `name` es "unknown" si el modelo pidió una tool que no existe.
   */
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
  /** Qué tools son propuestas (una por turno). Por defecto, `isProposalTool` del pipeline. */
  isProposal?: (toolName: string) => boolean;
  /** Gasto de turnos anteriores de esta conversación; null = desconocido → no sigue. */
  spentUsd: number | null;
  /** Versión del prompt de sistema (`assistant_chat@v1`); solo se registra. */
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

/**
 * Nombre de un error apto para log: solo si es un identificador corto. Un `name` armado con texto
 * del proveedor o del modelo no pasa. Propuesta: moverlo a error-code.ts y usarlo en client.ts.
 */
export function safeErrName(e: unknown): string {
  const name = e instanceof Error ? e.name : null;
  return typeof name === "string" && /^[A-Za-z0-9_$]{1,64}$/.test(name) ? name : "Error";
}

/** Conversión a `ModelMessage` del SDK. Exportada para tests. */
export function toModelMessages(messages: AgentChatMessage[]): ModelMessage[] {
  const out: ModelMessage[] = [];
  for (const m of messages) {
    if (m.role === "user") {
      out.push({ role: "user", content: m.content });
    } else if (m.role === "assistant") {
      const content = [
        ...(m.content ? [{ type: "text" as const, text: m.content }] : []),
        ...(m.toolCalls ?? []).map((c) => ({
          type: "tool-call" as const,
          toolCallId: c.id,
          toolName: c.name,
          input: c.input,
          ...(c.providerMetadata ? { providerOptions: c.providerMetadata } : {}),
        })),
      ];
      // Un mensaje vacío lo rechazan algunos proveedores: no se manda
      if (content.length > 0) out.push({ role: "assistant", content });
    } else {
      out.push({
        role: "tool",
        content: m.results.map((r) => ({
          type: "tool-result" as const,
          toolCallId: r.id,
          toolName: r.name,
          output: r.isError
            ? { type: "error-text" as const, value: r.output }
            : { type: "text" as const, value: r.output },
        })),
      });
    }
  }
  return out;
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
    ...(args.reasoning ? { reasoning: args.reasoning } : {}),
    // El error llega igual como parte `error` y el bucle lo normaliza a un código cerrado. El
    // default del SDK hace console.error del error entero, con requestBodyValues = el prompt.
    onError: () => {},
  });
  for await (const part of result.fullStream) {
    if (part.type === "text-delta") yield { type: "text-delta", text: part.text };
    else if (part.type === "tool-call") {
      yield {
        type: "tool-call",
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        input: part.input,
        ...(part.providerMetadata ? { providerMetadata: part.providerMetadata } : {}),
      };
    } else if (part.type === "finish") {
      yield {
        type: "finish",
        usage: {
          inputTokens: part.totalUsage.inputTokens,
          outputTokens: part.totalUsage.outputTokens,
          reasoningTokens: part.totalUsage.outputTokenDetails?.reasoningTokens,
        },
        finishReason: part.finishReason,
      };
    } else if (part.type === "abort") yield { type: "abort" };
    else if (part.type === "error") yield { type: "error", error: part.error };
  }
};

class AbortedError extends Error {
  constructor() {
    super("aborted");
    this.name = "AbortError";
  }
}

/** Una promesa o el corte por abort, lo que llegue primero (aunque la promesa ignore la señal). */
function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new AbortedError());
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new AbortedError());
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
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

/** La fila de llm_calls no se pudo escribir: sin fila no hay control de gasto, se corta. */
class RecordError extends Error {
  constructor() {
    super("record_failed");
    this.name = "RecordError";
  }
}

const toolError = (code: string) => ({ error: code });

/** Texto que estima la entrada: sistema, historial y las tools activas con su JSON Schema. */
function estimateInput(
  system: string,
  messages: AgentChatMessage[],
  tools: Record<string, AgentTool>,
  active: string[],
): number {
  const toolsText = active.map((n) => {
    const t = tools[n]!;
    let schema: unknown;
    try {
      schema = z.toJSONSchema(t.inputSchema);
    } catch {
      schema = null;
    }
    return [n, t.description, schema];
  });
  return estimateTokens(system + JSON.stringify(messages) + JSON.stringify(toolsText));
}

export async function* streamAgent(
  task: string,
  input: StreamAgentInput,
  ctx: StreamAgentCtx,
  deps: StreamAgentDeps,
): AsyncGenerator<AgentEvent> {
  // Error de programación en el borde: la etiqueta y la versión van a llm_calls, nunca texto libre
  if (!LABEL_RE.test(ctx.label)) throw new Error("streamAgent: label inválido (conv:<id>)");
  if (!PROMPT_VERSION_RE.test(input.promptVersion)) {
    throw new Error("streamAgent: promptVersion inválida");
  }
  const log = (deps.logger ?? createLogger()).child({
    task,
    user_id: ctx.userId,
    run_id: ctx.label,
  });
  try {
    yield* runTurn(task, input, ctx, deps, log);
  } catch (e) {
    log.error(
      { err: e instanceof RecordError ? "record_failed" : "unknown", err_name: safeErrName(e) },
      "asistente: el turno falló",
    );
    yield { type: "error", code: "generation_failed" };
  }
}

async function* runTurn(
  task: string,
  input: StreamAgentInput,
  ctx: StreamAgentCtx,
  deps: StreamAgentDeps,
  log: Logger,
): AsyncGenerator<AgentEvent> {
  const now = deps.now ?? Date.now;
  const streamFn = deps.streamFn ?? defaultAgentStreamFn;
  const isProposal = input.isProposal ?? isProposalTool;

  const record = async (route: RouteConfig, partial: Partial<LlmCallRecord>) => {
    try {
      await deps.calls.record({
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
    } catch {
      throw new RecordError();
    }
  };

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
    // El último paso responde en texto aunque el llamador ofrezca tools
    const active =
      step >= AGENT_LIMITS.maxStepsPerTurn - 1
        ? []
        : (
            input.activeTools?.(step, { proposalsSoFar: proposals }) ?? Object.keys(input.tools)
          ).filter((name) => name in input.tools);
    const estimate = estimateInput(input.system, messages, input.tools, active);
    const worstCase = maxStepCostUsd(rates, estimate);
    const cap = checkStep(step, estimate, spent, worstCase);
    if (!cap.ok) {
      log.info({ step, reason: cap.error }, "asistente: tope");
      yield { type: "cap", reason: cap.error };
      return;
    }

    const startedAt = now();
    let text = "";
    const toolCalls: AgentToolCall[] = [];
    let usage: { inputTokens?: number; outputTokens?: number; reasoningTokens?: number } | null =
      null;
    let finishReason: string | undefined;
    // Fila del paso: se escribe una vez, también si el consumidor corta el generador a mitad
    let recorded = false;
    const recordStep = async (partial: Partial<LlmCallRecord>) => {
      recorded = true;
      await record(route, { latencyMs: now() - startedAt, ...partial });
    };
    /** Costo de un paso que no terminó bien: el real si hubo usage, si no el peor caso. */
    const failedCost = () =>
      usage
        ? estimateCost(route, route.model, usage.inputTokens ?? null, usage.outputTokens ?? null)
        : worstCase;

    try {
      try {
        const it = streamFn({
          model,
          system: input.system,
          messages,
          tools: toolDefs,
          activeTools: active,
          maxOutputTokens,
          temperature: route.temperature,
          ...(route.thinkingLevel ? { reasoning: route.thinkingLevel } : {}),
          abortSignal: signal,
        })[Symbol.asyncIterator]();
        try {
          for (;;) {
            const r = await raceAbort(it.next(), signal);
            if (r.done) break;
            const part = r.value;
            if (part.type === "text-delta") {
              text += part.text;
              yield { type: "text", text: part.text };
            } else if (part.type === "tool-call") {
              toolCalls.push({
                id: part.toolCallId,
                name: part.toolName,
                input: part.input,
                ...(part.providerMetadata ? { providerMetadata: part.providerMetadata } : {}),
              });
            } else if (part.type === "finish") {
              usage = part.usage;
              finishReason = part.finishReason;
            } else if (part.type === "abort") {
              throw new AbortedError();
            } else if (part.type === "error") {
              throw part.error;
            }
          }
        } finally {
          // Un proveedor colgado puede no cerrar nunca: no se espera
          void Promise.resolve(it.return?.()).catch(() => undefined);
        }
        if (!usage) throw new Error("sin finish");
      } catch (e) {
        if (e instanceof RecordError) throw e;
        const stopped = signal.aborted;
        let code = stopped ? stopCode() : normalizeLlmError(e);
        // Un AbortError que no vino de nuestra señal no es un timeout ni un corte de la persona
        if (!stopped && (code === "aborted" || code === "timeout")) code = "unknown";
        await recordStep({ error: code.slice(0, 120), costUsd: failedCost() });
        log.error(
          { step, latency_ms: now() - startedAt, err: code, err_name: safeErrName(e) },
          "asistente: falló el paso",
        );
        yield { type: "error", code: stopped ? stopCode() : "generation_failed" };
        return;
      }

      const u = usage as { inputTokens?: number; outputTokens?: number; reasoningTokens?: number };
      const tokensIn = u.inputTokens ?? null;
      const tokensOut = u.outputTokens ?? null;
      const costUsd = estimateCost(route, route.model, tokensIn, tokensOut);
      spent = addCost(spent, costUsd);
      await recordStep({
        tokensIn,
        tokensOut,
        tokensReasoning: u.reasoningTokens ?? null,
        costUsd,
        ok: true,
      });
      log.info(
        {
          step,
          tokens_in: tokensIn,
          tokens_out: tokensOut,
          cost_usd: costUsd,
          latency_ms: now() - startedAt,
          tool_calls: toolCalls.length,
        },
        "asistente: paso",
      );
      if (finishReason === "length" || finishReason === "content-filter") {
        log.warn({ step, finish_reason: finishReason }, "asistente: el paso terminó cortado");
      }
      yield { type: "step", step, tokensIn, tokensOut, costUsd };
      // La estimación pudo quedarse corta: lo real manda
      if (tokensIn !== null && tokensIn > AGENT_LIMITS.maxInputTokensPerCall) {
        yield { type: "cap", reason: "input_tokens" };
        return;
      }
    } finally {
      if (!recorded) {
        // El consumidor cortó el generador (o algo salió por otro lado) después de llamar
        await record(route, {
          latencyMs: now() - startedAt,
          error: "aborted",
          costUsd: failedCost(),
        }).catch(() => log.error({ err: "record_failed" }, "asistente: sin fila del paso"));
      }
    }

    if (toolCalls.length === 0) {
      yield { type: "done", steps: step + 1, costUsd: spent };
      return;
    }

    const results: AgentToolResult[] = [];
    for (const [i, call] of toolCalls.entries()) {
      const t = Object.hasOwn(input.tools, call.name) ? input.tools[call.name] : undefined;
      let output: unknown;
      let modelText: string | null = null;
      let isError = true;
      let validInput: unknown = null;
      if (i >= MAX_TOOL_CALLS_PER_STEP) {
        output = toolError("demasiadas_tools");
      } else if (!t || !active.includes(call.name)) {
        output = toolError("tool_no_disponible");
      } else if (isProposal(call.name) && proposals >= 1) {
        output = toolError("una_propuesta_por_turno");
      } else {
        const parsed = t.inputSchema.safeParse(call.input);
        if (!parsed.success) {
          // Sin eco del input: puede traer texto de la persona o de un aviso
          output = toolError("entrada_invalida");
        } else {
          validInput = parsed.data;
          try {
            output = await raceAbort(t.execute(parsed.data, { signal }), signal);
            modelText = t.toModelText ? t.toModelText(output) : JSON.stringify(output ?? null);
            isError = false;
          } catch (e) {
            if (signal.aborted) {
              yield { type: "error", code: stopCode() };
              return;
            }
            log.warn({ step, tool: call.name, err_name: safeErrName(e) }, "asistente: tool falló");
            output = toolError("tool_fallo");
          }
        }
      }
      if (!isError && isProposal(call.name)) proposals++;
      yield {
        type: "tool",
        name: t ? call.name : "unknown",
        input: validInput,
        output,
        isError,
      };
      results.push({
        id: call.id,
        name: call.name,
        output: modelText ?? JSON.stringify(output),
        isError,
      });
    }
    messages.push({ role: "assistant", content: text, toolCalls });
    messages.push({ role: "tool", results });
  }
}
