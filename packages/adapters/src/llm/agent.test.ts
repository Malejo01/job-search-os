import type { LanguageModel } from "ai";
import pino from "pino";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  AGENT_DEADLINE_MS,
  ASSISTANT_TASK,
  streamAgent,
  type AgentEvent,
  type AgentStreamFn,
  type AgentStreamPart,
  type AgentTool,
  type StreamAgentDeps,
  type StreamAgentInput,
} from "./agent";
import { createScriptedStreamFn } from "./agent-demo";
import { memoryCallSink } from "./calls";
import { staticRouteSource } from "./router";
import type { ProviderRegistry, RouteConfig } from "./types";

const ROUTE: RouteConfig = {
  task: ASSISTANT_TASK,
  provider: "fake",
  model: "fake-agent",
  fallbackModel: null,
  temperature: 0.2,
  maxTokens: 2048,
  thinkingLevel: null,
  // Tarifas chicas pero conocidas: el costo de cada paso es calculable
  inputUsdPerMtok: 1,
  outputUsdPerMtok: 2,
  fallbackInputUsdPerMtok: null,
  fallbackOutputUsdPerMtok: null,
};

const providers: ProviderRegistry = {
  modelFor: (provider) => (provider === "fake" ? ({} as LanguageModel) : null),
};

const SECRET = "Me mudé a Montevideo hace dos años y busco remoto";

function deps(
  streamFn: AgentStreamFn,
  extra: Partial<StreamAgentDeps> = {},
  route: RouteConfig = ROUTE,
) {
  const calls = memoryCallSink();
  return {
    calls,
    deps: {
      routes: staticRouteSource([route]),
      calls,
      providers,
      streamFn,
      logger: pino({ level: "silent" }),
      ...extra,
    } satisfies StreamAgentDeps,
  };
}

const getProfile: AgentTool = {
  description: "Lee el perfil",
  inputSchema: z.object({}).strict(),
  execute: vi.fn(async () => ({ country: "AR" })),
};

function input(extra: Partial<StreamAgentInput> = {}): StreamAgentInput {
  return {
    system: "sistema de prueba",
    messages: [{ role: "user", content: SECRET }],
    tools: { get_profile: getProfile },
    spentUsd: 0,
    promptVersion: "assistant_chat@v1",
    ...extra,
  };
}

const ctx = { userId: "00000000-0000-4000-8000-000000000001", label: "conv:abc123" };

async function collect(gen: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

const finish = (inputTokens = 100, outputTokens = 20): AgentStreamPart => ({
  type: "finish",
  usage: { inputTokens, outputTokens },
});

describe("streamAgent", () => {
  it("sin fila en model_routing falla cerrado sin llamar al modelo", async () => {
    const streamFn = vi.fn(createScriptedStreamFn([[finish()]]));
    const { deps: d, calls } = deps(streamFn, { routes: staticRouteSource([]) });
    const events = await collect(streamAgent(ASSISTANT_TASK, input(), ctx, d));
    expect(events).toEqual([{ type: "error", code: "no_route" }]);
    expect(streamFn).not.toHaveBeenCalled();
    expect(calls.calls).toHaveLength(0);
  });

  it("proveedor sin clave: registra provider_unavailable y no llama", async () => {
    const streamFn = vi.fn(createScriptedStreamFn([[finish()]]));
    const { deps: d, calls } = deps(streamFn, { providers: { modelFor: () => null } });
    const events = await collect(streamAgent(ASSISTANT_TASK, input(), ctx, d));
    expect(events).toEqual([{ type: "error", code: "provider_unavailable" }]);
    expect(streamFn).not.toHaveBeenCalled();
    expect(calls.calls).toMatchObject([{ ok: false, error: "provider_unavailable" }]);
  });

  it("respuesta en texto: deltas, un paso, una fila sin contenido", async () => {
    const streamFn = createScriptedStreamFn([
      [
        { type: "text-delta", text: "Hola, " },
        { type: "text-delta", text: "¿qué cambio?" },
        finish(),
      ],
    ]);
    const { deps: d, calls } = deps(streamFn);
    const events = await collect(streamAgent(ASSISTANT_TASK, input(), ctx, d));
    expect(
      events.filter((e) => e.type === "text").map((e) => (e as { text: string }).text),
    ).toEqual(["Hola, ", "¿qué cambio?"]);
    const step = events.find((e) => e.type === "step");
    // 100 * 1 + 20 * 2 = 140 por millón
    expect(step).toEqual({ type: "step", step: 0, tokensIn: 100, tokensOut: 20, costUsd: 0.00014 });
    expect(events.at(-1)).toEqual({ type: "done", steps: 1, costUsd: 0.00014 });
    expect(calls.calls).toHaveLength(1);
    const row = calls.calls[0]!;
    expect(row).toMatchObject({
      task: ASSISTANT_TASK,
      model: "fake-agent",
      promptVersion: "assistant_chat@v1",
      label: "conv:abc123",
      userId: ctx.userId,
      jobId: null,
      ok: true,
      error: null,
    });
    // Ningún campo de la fila lleva texto de la conversación
    const serialized = JSON.stringify(row);
    expect(serialized).not.toContain("Montevideo");
    expect(serialized).not.toContain("qué cambio");
  });

  it("tool de lectura: la ejecuta y sigue un segundo paso; dos filas", async () => {
    const execute = vi.fn(async () => ({ country: "AR" }));
    const streamFn = vi.fn(
      createScriptedStreamFn([
        [{ type: "tool-call", toolCallId: "t1", toolName: "get_profile", input: {} }, finish()],
        [{ type: "text-delta", text: "Tu país es AR" }, finish()],
      ]),
    );
    const { deps: d, calls } = deps(streamFn);
    const events = await collect(
      streamAgent(
        ASSISTANT_TASK,
        input({ tools: { get_profile: { ...getProfile, execute } } }),
        ctx,
        d,
      ),
    );
    expect(execute).toHaveBeenCalledOnce();
    expect(events).toContainEqual({
      type: "tool",
      name: "get_profile",
      input: {},
      output: { country: "AR" },
      isError: false,
    });
    expect(calls.calls).toHaveLength(2);
    // El segundo paso recibe la llamada y su resultado
    const second = streamFn.mock.calls[1]![0];
    expect(second.messages.at(-2)).toMatchObject({
      role: "assistant",
      toolCalls: [{ id: "t1", name: "get_profile", input: {} }],
    });
    expect(second.messages.at(-1)).toEqual({
      role: "tool",
      results: [{ id: "t1", name: "get_profile", output: '{"country":"AR"}', isError: false }],
    });
    expect(events.at(-1)).toMatchObject({ type: "done", steps: 2 });
  });

  it("tool fuera de las activas: no se ejecuta", async () => {
    const execute = vi.fn(async () => ({}));
    const streamFn = createScriptedStreamFn([
      [{ type: "tool-call", toolCallId: "t1", toolName: "get_profile", input: {} }, finish()],
      [{ type: "text-delta", text: "ok" }, finish()],
    ]);
    const { deps: d } = deps(streamFn);
    const events = await collect(
      streamAgent(
        ASSISTANT_TASK,
        input({ tools: { get_profile: { ...getProfile, execute } }, activeTools: () => [] }),
        ctx,
        d,
      ),
    );
    expect(execute).not.toHaveBeenCalled();
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool",
        isError: true,
        output: { error: "tool_no_disponible" },
      }),
    );
  });

  it("tool desconocida: no_disponible", async () => {
    const streamFn = createScriptedStreamFn([
      [{ type: "tool-call", toolCallId: "t1", toolName: "save_everything", input: {} }, finish()],
      [{ type: "text-delta", text: "ok" }, finish()],
    ]);
    const { deps: d } = deps(streamFn);
    const events = await collect(streamAgent(ASSISTANT_TASK, input(), ctx, d));
    expect(events).toContainEqual(
      expect.objectContaining({
        name: "unknown",
        input: null,
        output: { error: "tool_no_disponible" },
      }),
    );
  });

  it("input inválido: entrada_invalida sin eco y sin ejecutar", async () => {
    const execute = vi.fn(async () => ({}));
    const streamFn = createScriptedStreamFn([
      [
        { type: "tool-call", toolCallId: "t1", toolName: "get_profile", input: { x: SECRET } },
        finish(),
      ],
      [{ type: "text-delta", text: "ok" }, finish()],
    ]);
    const { deps: d } = deps(streamFn);
    const events = await collect(
      streamAgent(
        ASSISTANT_TASK,
        input({ tools: { get_profile: { ...getProfile, execute } } }),
        ctx,
        d,
      ),
    );
    expect(execute).not.toHaveBeenCalled();
    const tool = events.find((e) => e.type === "tool");
    expect(tool).toMatchObject({ isError: true, output: { error: "entrada_invalida" } });
  });

  it("execute que lanza: tool_fallo y el turno sigue", async () => {
    const streamFn = createScriptedStreamFn([
      [{ type: "tool-call", toolCallId: "t1", toolName: "get_profile", input: {} }, finish()],
      [{ type: "text-delta", text: "No pude leerlo" }, finish()],
    ]);
    const { deps: d } = deps(streamFn);
    const failing: AgentTool = {
      ...getProfile,
      execute: async () => {
        throw new Error(`boom ${SECRET}`);
      },
    };
    const events = await collect(
      streamAgent(ASSISTANT_TASK, input({ tools: { get_profile: failing } }), ctx, d),
    );
    expect(events).toContainEqual(
      expect.objectContaining({ type: "tool", isError: true, output: { error: "tool_fallo" } }),
    );
    expect(events.at(-1)).toMatchObject({ type: "done", steps: 2 });
  });

  it("cuenta las propuestas y se las pasa a activeTools", async () => {
    const propose: AgentTool = {
      description: "propone",
      inputSchema: z.object({}).strict(),
      execute: async () => ({ ok: true }),
    };
    const seen: { step: number; proposalsSoFar: number }[] = [];
    const streamFn = createScriptedStreamFn([
      [{ type: "tool-call", toolCallId: "t1", toolName: "propose_profile", input: {} }, finish()],
      [{ type: "text-delta", text: "listo" }, finish()],
    ]);
    const { deps: d } = deps(streamFn);
    await collect(
      streamAgent(
        ASSISTANT_TASK,
        input({
          tools: { propose_profile: propose },
          isProposal: (n) => n.startsWith("propose_"),
          activeTools: (step, state) => {
            seen.push({ step, ...state });
            return ["propose_profile"];
          },
        }),
        ctx,
        d,
      ),
    );
    expect(seen).toEqual([
      { step: 0, proposalsSoFar: 0 },
      { step: 1, proposalsSoFar: 1 },
    ]);
  });

  it("tope de pasos: un guion que siempre pide tools corta en el paso 6", async () => {
    const loop: AgentStreamFn = async function* () {
      yield { type: "tool-call", toolCallId: "t", toolName: "get_profile", input: {} };
      yield finish(10, 5);
    };
    const streamFn = vi.fn(loop);
    const { deps: d, calls } = deps(streamFn);
    const events = await collect(streamAgent(ASSISTANT_TASK, input(), ctx, d));
    expect(streamFn).toHaveBeenCalledTimes(6);
    expect(calls.calls).toHaveLength(6);
    expect(events.at(-1)).toEqual({ type: "cap", reason: "steps" });
  });

  it("tope en USD: con lo gastado cerca del tope corta antes de llamar", async () => {
    const streamFn = vi.fn(createScriptedStreamFn([[finish()]]));
    const pricey = { ...ROUTE, inputUsdPerMtok: 3, outputUsdPerMtok: 15 };
    const { deps: d, calls } = deps(streamFn, {}, pricey);
    const events = await collect(streamAgent(ASSISTANT_TASK, input({ spentUsd: 0.119 }), ctx, d));
    expect(events).toEqual([{ type: "cap", reason: "usd" }]);
    expect(streamFn).not.toHaveBeenCalled();
    expect(calls.calls).toHaveLength(0);
  });

  it("gasto previo desconocido: cost_unknown", async () => {
    const streamFn = vi.fn(createScriptedStreamFn([[finish()]]));
    const { deps: d } = deps(streamFn);
    const events = await collect(streamAgent(ASSISTANT_TASK, input({ spentUsd: null }), ctx, d));
    expect(events).toEqual([{ type: "cap", reason: "cost_unknown" }]);
    expect(streamFn).not.toHaveBeenCalled();
  });

  it("ruta sin tarifas: cost_unknown", async () => {
    const streamFn = vi.fn(createScriptedStreamFn([[finish()]]));
    const { deps: d } = deps(streamFn, {}, { ...ROUTE, inputUsdPerMtok: null });
    const events = await collect(streamAgent(ASSISTANT_TASK, input(), ctx, d));
    expect(events).toEqual([{ type: "cap", reason: "cost_unknown" }]);
    expect(streamFn).not.toHaveBeenCalled();
  });

  it("el proveedor no informa tokens: el paso siguiente corta por cost_unknown", async () => {
    const streamFn = createScriptedStreamFn([
      [
        { type: "tool-call", toolCallId: "t1", toolName: "get_profile", input: {} },
        { type: "finish", usage: {} },
      ],
      [{ type: "text-delta", text: "no llega" }, finish()],
    ]);
    const { deps: d } = deps(streamFn);
    const events = await collect(streamAgent(ASSISTANT_TASK, input(), ctx, d));
    expect(events.at(-1)).toEqual({ type: "cap", reason: "cost_unknown" });
  });

  it("entrada demasiado larga: input_tokens antes de llamar", async () => {
    const streamFn = vi.fn(createScriptedStreamFn([[finish()]]));
    const { deps: d } = deps(streamFn);
    const long = "a".repeat(40_000);
    const events = await collect(
      streamAgent(ASSISTANT_TASK, input({ messages: [{ role: "user", content: long }] }), ctx, d),
    );
    expect(events).toEqual([{ type: "cap", reason: "input_tokens" }]);
    expect(streamFn).not.toHaveBeenCalled();
  });

  it("maxOutputTokens es el menor entre la ruta y 600; pasa system y tools activas", async () => {
    const streamFn = vi.fn(createScriptedStreamFn([[finish()], [finish()]]));
    const { deps: d } = deps(streamFn);
    await collect(streamAgent(ASSISTANT_TASK, input(), ctx, d));
    expect(streamFn.mock.calls[0]![0]).toMatchObject({
      maxOutputTokens: 600,
      temperature: 0.2,
      system: "sistema de prueba",
      activeTools: ["get_profile"],
    });
    const small = deps(streamFn, {}, { ...ROUTE, maxTokens: 300 });
    await collect(streamAgent(ASSISTANT_TASK, input(), ctx, small.deps));
    expect(streamFn.mock.calls[1]![0].maxOutputTokens).toBe(300);
  });

  it("deadline propio: un proveedor colgado termina en timeout y deja la fila", async () => {
    const hanging: AgentStreamFn = (args) => ({
      [Symbol.asyncIterator]: () => ({
        next: () =>
          new Promise<IteratorResult<AgentStreamPart>>(() => {
            /* nunca resuelve, ni siquiera con abort */
            void args;
          }),
      }),
    });
    const { deps: d, calls } = deps(hanging, { deadlineMs: 30 });
    const events = await collect(streamAgent(ASSISTANT_TASK, input(), ctx, d));
    expect(events.at(-1)).toEqual({ type: "error", code: "timeout" });
    expect(calls.calls).toMatchObject([{ ok: false, error: "timeout", label: "conv:abc123" }]);
  });

  it("abort externo: aborted", async () => {
    const controller = new AbortController();
    const streamFn: AgentStreamFn = async function* (args) {
      yield { type: "text-delta", text: "empiezo" };
      controller.abort();
      await new Promise((_, reject) =>
        args.abortSignal.addEventListener("abort", () =>
          reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
        ),
      );
    };
    const { deps: d, calls } = deps(streamFn);
    const events = await collect(
      streamAgent(ASSISTANT_TASK, input({ signal: controller.signal }), ctx, d),
    );
    expect(events.at(-1)).toEqual({ type: "error", code: "aborted" });
    expect(calls.calls).toMatchObject([{ ok: false, error: "aborted" }]);
  });

  it("error del proveedor: código cerrado, nunca el mensaje", async () => {
    const streamFn = createScriptedStreamFn([
      [{ type: "error", error: new Error(`el proveedor citó: ${SECRET}`) }],
    ]);
    const { deps: d, calls } = deps(streamFn);
    const events = await collect(streamAgent(ASSISTANT_TASK, input(), ctx, d));
    expect(events.at(-1)).toEqual({ type: "error", code: "generation_failed" });
    expect(calls.calls[0]!.ok).toBe(false);
    expect(JSON.stringify(calls.calls)).not.toContain("Montevideo");
  });

  it("el deadline por defecto es 50 s", () => {
    expect(AGENT_DEADLINE_MS).toBe(50_000);
  });
});
