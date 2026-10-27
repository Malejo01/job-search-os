import { APICallError, type LanguageModel } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import pino from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  ASSISTANT_TASK,
  defaultAgentStreamFn,
  MAX_TOOL_CALLS_PER_STEP,
  safeErrName,
  streamAgent,
  toModelMessages,
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
import type { CallSink, ProviderRegistry, RouteConfig } from "./types";

/** Arreglos de la revisión de AG-1: una propuesta por turno, filas siempre registradas, privacidad. */

const ROUTE: RouteConfig = {
  task: ASSISTANT_TASK,
  provider: "fake",
  model: "fake-agent",
  fallbackModel: null,
  temperature: 0.2,
  maxTokens: 2048,
  thinkingLevel: null,
  inputUsdPerMtok: 1,
  outputUsdPerMtok: 2,
  fallbackInputUsdPerMtok: null,
  fallbackOutputUsdPerMtok: null,
};

const SECRET = "Vivo en Quebrada Ficticia 123 y mi resumen dice cosas privadas";

const providers: ProviderRegistry = {
  modelFor: (provider) => (provider === "fake" ? ({} as LanguageModel) : null),
};

function memoryLogger() {
  const lines: string[] = [];
  const logger = pino({ level: "debug" }, { write: (s: string) => void lines.push(s) });
  return { logger, lines };
}

function deps(streamFn: AgentStreamFn, extra: Partial<StreamAgentDeps> = {}, route = ROUTE) {
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

const noop = (): AgentTool => ({
  description: "tool",
  inputSchema: z.object({}).strict(),
  execute: vi.fn(async () => ({ ok: true })),
});

function input(extra: Partial<StreamAgentInput> = {}): StreamAgentInput {
  return {
    system: "sistema",
    messages: [{ role: "user", content: SECRET }],
    tools: { get_profile: noop() },
    spentUsd: 0,
    promptVersion: "assistant_chat@v1",
    ...extra,
  };
}

const ctx = { userId: "00000000-0000-4000-8000-000000000003", label: "conv:rev123" };

async function collect(gen: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

const finish = (inputTokens = 100, outputTokens = 20, finishReason?: string): AgentStreamPart => ({
  type: "finish",
  usage: { inputTokens, outputTokens },
  ...(finishReason ? { finishReason } : {}),
});
const call = (id: string, toolName: string, inp: unknown = {}): AgentStreamPart => ({
  type: "tool-call",
  toolCallId: id,
  toolName,
  input: inp,
});

afterEach(() => vi.restoreAllMocks());

describe("una propuesta por turno", () => {
  it("dos propose_profile y un propose_criteria en el mismo paso: una sola se ejecuta", async () => {
    const profile = noop();
    const criteria = noop();
    const streamFn = createScriptedStreamFn([
      [
        call("a", "propose_profile"),
        call("b", "propose_profile"),
        call("c", "propose_criteria"),
        finish(),
      ],
      [{ type: "text-delta", text: "listo" }, finish()],
    ]);
    const { deps: d } = deps(streamFn);
    const events = await collect(
      streamAgent(
        ASSISTANT_TASK,
        input({ tools: { propose_profile: profile, propose_criteria: criteria } }),
        ctx,
        d,
      ),
    );
    const tools = events.filter((e) => e.type === "tool");
    expect(tools.map((t) => (t as { isError: boolean }).isError)).toEqual([false, true, true]);
    expect(tools[1]).toMatchObject({ output: { error: "una_propuesta_por_turno" } });
    expect(tools[2]).toMatchObject({ output: { error: "una_propuesta_por_turno" } });
    expect(profile.execute).toHaveBeenCalledOnce();
    expect(criteria.execute).not.toHaveBeenCalled();
  });

  it("más de 4 tool calls en un paso: las que sobran no se ejecutan", async () => {
    const t = noop();
    const parts = Array.from({ length: 6 }, (_, i) => call(`t${i}`, "get_profile"));
    const streamFn = createScriptedStreamFn([
      [...parts, finish()],
      [{ type: "text-delta", text: "ok" }, finish()],
    ]);
    const { deps: d } = deps(streamFn);
    const events = await collect(
      streamAgent(ASSISTANT_TASK, input({ tools: { get_profile: t } }), ctx, d),
    );
    expect(t.execute).toHaveBeenCalledTimes(MAX_TOOL_CALLS_PER_STEP);
    const errors = events.filter(
      (e) => e.type === "tool" && (e.output as { error?: string }).error === "demasiadas_tools",
    );
    expect(errors).toHaveLength(2);
  });
});

describe("defaultAgentStreamFn con el SDK", () => {
  it("un APICallError no va a console.error y queda un código cerrado", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const model = new MockLanguageModelV4({
      doStream: async () => {
        throw new APICallError({
          message: "falló",
          url: "https://proveedor.invalid/v1",
          requestBodyValues: { prompt: SECRET },
          statusCode: 500,
        });
      },
    });
    const { deps: d, calls } = deps(defaultAgentStreamFn, {
      providers: { modelFor: () => model },
    });
    const events = await collect(streamAgent(ASSISTANT_TASK, input(), ctx, d));
    expect(events.at(-1)).toEqual({ type: "error", code: "generation_failed" });
    expect(consoleError).not.toHaveBeenCalled();
    expect(calls.calls).toHaveLength(1);
    expect(calls.calls[0]).toMatchObject({ ok: false, error: "api_call:500" });
    expect(JSON.stringify(calls.calls)).not.toContain("Quebrada");
  });

  it("pasa el razonamiento de la ruta y cuenta los tokens del SDK", async () => {
    const model = new MockLanguageModelV4({
      doStream: async () => ({
        stream: new ReadableStream({
          start(c) {
            c.enqueue({ type: "stream-start", warnings: [] });
            c.enqueue({ type: "text-start", id: "1" });
            c.enqueue({ type: "text-delta", id: "1", delta: "hola" });
            c.enqueue({ type: "text-end", id: "1" });
            c.enqueue({
              type: "finish",
              finishReason: { unified: "stop", raw: "stop" },
              usage: {
                inputTokens: { total: 30, noCache: 30, cacheRead: 0, cacheWrite: 0 },
                outputTokens: { total: 5, text: 5, reasoning: 0 },
              },
            });
            c.close();
          },
        }),
      }),
    });
    const { deps: d, calls } = deps(
      defaultAgentStreamFn,
      { providers: { modelFor: () => model } },
      { ...ROUTE, thinkingLevel: "low" },
    );
    const events = await collect(streamAgent(ASSISTANT_TASK, input(), ctx, d));
    expect(events).toContainEqual({ type: "text", text: "hola" });
    expect(calls.calls[0]).toMatchObject({ ok: true, tokensIn: 30, tokensOut: 5 });
  });
});

describe("razonamiento", () => {
  it("la fila de model_routing con thinking_level llega al streamFn", async () => {
    const streamFn = vi.fn(createScriptedStreamFn([[finish()], [finish()]]));
    const low = deps(streamFn, {}, { ...ROUTE, thinkingLevel: "low" });
    await collect(streamAgent(ASSISTANT_TASK, input(), ctx, low.deps));
    expect(streamFn.mock.calls[0]![0].reasoning).toBe("low");
    const none = deps(streamFn);
    await collect(streamAgent(ASSISTANT_TASK, input(), ctx, none.deps));
    expect(streamFn.mock.calls[1]![0]).not.toHaveProperty("reasoning");
  });
});

describe("filas siempre registradas", () => {
  it("el consumidor corta en el primer texto: queda una fila aborted con el peor caso", async () => {
    const streamFn = createScriptedStreamFn([
      [{ type: "text-delta", text: "uno" }, { type: "text-delta", text: "dos" }, finish()],
    ]);
    const { deps: d, calls } = deps(streamFn);
    for await (const e of streamAgent(ASSISTANT_TASK, input(), ctx, d)) {
      if (e.type === "text") break;
    }
    expect(calls.calls).toHaveLength(1);
    expect(calls.calls[0]).toMatchObject({ ok: false, error: "aborted", label: "conv:rev123" });
    // Peor caso: incluye los 600 tokens de salida máximos a 2 USD/Mtok
    expect(calls.calls[0]!.costUsd).toBeGreaterThan(600 * 2e-6);
  });

  it("el stream termina sin finish: unknown con el peor caso", async () => {
    const streamFn = createScriptedStreamFn([[{ type: "text-delta", text: "a medias" }]]);
    const { deps: d, calls } = deps(streamFn);
    const events = await collect(streamAgent(ASSISTANT_TASK, input(), ctx, d));
    expect(events.at(-1)).toEqual({ type: "error", code: "generation_failed" });
    expect(calls.calls[0]).toMatchObject({ ok: false, error: "unknown" });
    expect(calls.calls[0]!.costUsd).toBeGreaterThan(0);
  });

  it("error después de un finish parcial: costo real", async () => {
    const streamFn = createScriptedStreamFn([
      [finish(10, 10), { type: "error", error: new Error("x") }],
    ]);
    const { deps: d, calls } = deps(streamFn);
    await collect(streamAgent(ASSISTANT_TASK, input(), ctx, d));
    expect(calls.calls[0]).toMatchObject({ ok: false, costUsd: 0.00003 });
  });

  it("parte abort del SDK: aborted", async () => {
    const controller = new AbortController();
    const streamFn: AgentStreamFn = async function* () {
      controller.abort();
      yield { type: "abort" };
    };
    const { deps: d, calls } = deps(streamFn);
    const events = await collect(
      streamAgent(ASSISTANT_TASK, input({ signal: controller.signal }), ctx, d),
    );
    expect(events.at(-1)).toEqual({ type: "error", code: "aborted" });
    expect(calls.calls[0]).toMatchObject({ error: "aborted" });
  });

  it("AbortError ajeno a nuestras señales: no es timeout", async () => {
    const streamFn = createScriptedStreamFn([
      [{ type: "error", error: Object.assign(new Error("x"), { name: "AbortError" }) }],
    ]);
    const { deps: d, calls } = deps(streamFn);
    const events = await collect(streamAgent(ASSISTANT_TASK, input(), ctx, d));
    expect(events.at(-1)).toEqual({ type: "error", code: "generation_failed" });
    expect(calls.calls[0]).toMatchObject({ error: "unknown" });
  });
});

describe("nunca lanza", () => {
  it("el registro de llm_calls falla: corta con error, sin lanzar", async () => {
    const broken: CallSink = {
      record: async () => {
        throw new Error("db caída");
      },
    };
    const streamFn = createScriptedStreamFn([[finish()]]);
    const { deps: d } = deps(streamFn, { calls: broken });
    const events = await collect(streamAgent(ASSISTANT_TASK, input(), ctx, d));
    expect(events.at(-1)).toEqual({ type: "error", code: "generation_failed" });
    expect(events.some((e) => e.type === "done")).toBe(false);
  });

  it("toModelText que lanza: tool_fallo", async () => {
    const t: AgentTool = {
      ...noop(),
      toModelText: () => {
        throw new Error("no serializa");
      },
    };
    const streamFn = createScriptedStreamFn([
      [call("a", "get_profile"), finish()],
      [{ type: "text-delta", text: "ok" }, finish()],
    ]);
    const { deps: d } = deps(streamFn);
    const events = await collect(
      streamAgent(ASSISTANT_TASK, input({ tools: { get_profile: t } }), ctx, d),
    );
    expect(events).toContainEqual(
      expect.objectContaining({ type: "tool", isError: true, output: { error: "tool_fallo" } }),
    );
  });

  it("activeTools que lanza: generation_failed", async () => {
    const streamFn = createScriptedStreamFn([[finish()]]);
    const { deps: d } = deps(streamFn);
    const events = await collect(
      streamAgent(
        ASSISTANT_TASK,
        input({
          activeTools: () => {
            throw new Error("bug");
          },
        }),
        ctx,
        d,
      ),
    );
    expect(events).toEqual([{ type: "error", code: "generation_failed" }]);
  });
});

describe("deadline y topes", () => {
  it("una tool colgada corta el turno por timeout", async () => {
    const hanging: AgentTool = {
      ...noop(),
      execute: () => new Promise(() => {}),
    };
    const streamFn = createScriptedStreamFn([[call("a", "get_profile"), finish()]]);
    const { deps: d } = deps(streamFn, { deadlineMs: 30 });
    const events = await collect(
      streamAgent(ASSISTANT_TASK, input({ tools: { get_profile: hanging } }), ctx, d),
    );
    expect(events.at(-1)).toEqual({ type: "error", code: "timeout" });
  });

  it("el último paso va sin tools aunque la app ofrezca", async () => {
    const seen: string[][] = [];
    const streamFn: AgentStreamFn = async function* (args) {
      seen.push(args.activeTools);
      yield call("x", "get_profile");
      yield finish(10, 5);
    };
    const { deps: d } = deps(streamFn);
    await collect(
      streamAgent(ASSISTANT_TASK, input({ activeTools: () => ["get_profile"] }), ctx, d),
    );
    expect(seen).toHaveLength(6);
    expect(seen[4]).toEqual(["get_profile"]);
    expect(seen[5]).toEqual([]);
  });

  it("tokens de entrada reales sobre el tope: corta después del paso", async () => {
    const streamFn = createScriptedStreamFn([
      [call("a", "get_profile"), finish(12_001, 10)],
      [{ type: "text-delta", text: "no llega" }, finish()],
    ]);
    const { deps: d } = deps(streamFn);
    const events = await collect(streamAgent(ASSISTANT_TASK, input(), ctx, d));
    expect(events.at(-1)).toEqual({ type: "cap", reason: "input_tokens" });
    expect(events.some((e) => e.type === "tool")).toBe(false);
  });

  it("la estimación incluye el JSON Schema de las tools activas", async () => {
    // Un schema enorme hace pasar el tope de entrada aunque el historial sea corto
    const big = z.object(
      Object.fromEntries(
        Array.from({ length: 400 }, (_, i) => [
          `campo_${i}`,
          z.string().describe("x".repeat(80)).optional(),
        ]),
      ),
    );
    const t: AgentTool = { description: "d", inputSchema: big, execute: async () => ({}) };
    const streamFn = vi.fn(createScriptedStreamFn([[finish()]]));
    const { deps: d } = deps(streamFn);
    const events = await collect(
      streamAgent(ASSISTANT_TASK, input({ tools: { get_profile: t } }), ctx, d),
    );
    expect(events).toEqual([{ type: "cap", reason: "input_tokens" }]);
    expect(streamFn).not.toHaveBeenCalled();
  });

  it("finish por largo: log.warn con el motivo y el paso sigue", async () => {
    const { logger, lines } = memoryLogger();
    const streamFn = createScriptedStreamFn([
      [{ type: "text-delta", text: "cortado" }, finish(10, 600, "length")],
    ]);
    const { deps: d } = deps(streamFn, { logger });
    const events = await collect(streamAgent(ASSISTANT_TASK, input(), ctx, d));
    expect(events.at(-1)).toMatchObject({ type: "done" });
    expect(lines.some((l) => l.includes('"finish_reason":"length"'))).toBe(true);
  });
});

describe("conversión de mensajes", () => {
  it("la firma del proveedor vuelve como providerOptions; errores como error-text; vacío se omite", () => {
    const meta = { google: { thoughtSignature: "firma-ficticia" } };
    const out = toModelMessages([
      { role: "user", content: "hola" },
      { role: "assistant", content: "" },
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "a", name: "get_profile", input: {}, providerMetadata: meta }],
      },
      {
        role: "tool",
        results: [
          { id: "a", name: "get_profile", output: '{"error":"tool_fallo"}', isError: true },
        ],
      },
    ]);
    expect(out).toHaveLength(3);
    expect(out[1]).toEqual({
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId: "a",
          toolName: "get_profile",
          input: {},
          providerOptions: meta,
        },
      ],
    });
    expect(out[2]).toEqual({
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "a",
          toolName: "get_profile",
          output: { type: "error-text", value: '{"error":"tool_fallo"}' },
        },
      ],
    });
  });

  it("la firma que llega en el stream vuelve en el paso siguiente", async () => {
    const meta = { google: { thoughtSignature: "firma-2" } };
    const streamFn = vi.fn(
      createScriptedStreamFn([
        [{ ...call("a", "get_profile"), providerMetadata: meta } as AgentStreamPart, finish()],
        [{ type: "text-delta", text: "ok" }, finish()],
      ]),
    );
    const { deps: d } = deps(streamFn);
    await collect(streamAgent(ASSISTANT_TASK, input(), ctx, d));
    const second = streamFn.mock.calls[1]![0];
    expect(second.messages.at(-2)).toMatchObject({
      toolCalls: [{ id: "a", providerMetadata: meta }],
    });
  });
});

describe("privacidad", () => {
  it("evento tool: input null si no validó", async () => {
    const streamFn = createScriptedStreamFn([
      [call("a", "get_profile", { texto: SECRET }), finish()],
      [{ type: "text-delta", text: "ok" }, finish()],
    ]);
    const { deps: d } = deps(streamFn);
    const events = await collect(streamAgent(ASSISTANT_TASK, input(), ctx, d));
    expect(events.find((e) => e.type === "tool")).toMatchObject({ input: null, isError: true });
  });

  it("label y versión de prompt mal formados: error de programación al empezar", async () => {
    const streamFn = createScriptedStreamFn([[finish()]]);
    const { deps: d } = deps(streamFn);
    await expect(
      collect(streamAgent(ASSISTANT_TASK, input(), { ...ctx, label: `conv:${SECRET}` }, d)),
    ).rejects.toThrow(/label/);
    await expect(
      collect(streamAgent(ASSISTANT_TASK, input({ promptVersion: SECRET }), ctx, d)),
    ).rejects.toThrow(/promptVersion/);
  });

  it("safeErrName: solo identificadores cortos", () => {
    expect(safeErrName(new TypeError("x"))).toBe("TypeError");
    expect(safeErrName(Object.assign(new Error("x"), { name: `Error: ${SECRET}` }))).toBe("Error");
    expect(safeErrName("texto")).toBe("Error");
  });

  it("los logs no llevan texto de mensajes ni del perfil (tool que lanza y error del proveedor)", async () => {
    const { logger, lines } = memoryLogger();
    const failing: AgentTool = {
      ...noop(),
      execute: async () => {
        throw Object.assign(new Error(SECRET), { name: SECRET });
      },
    };
    const streamFn = createScriptedStreamFn([
      [call("a", "get_profile"), finish()],
      [{ type: "error", error: new Error(`proveedor: ${SECRET}`) }],
    ]);
    const { deps: d } = deps(streamFn, { logger });
    await collect(streamAgent(ASSISTANT_TASK, input({ tools: { get_profile: failing } }), ctx, d));
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join("\n")).not.toContain("Quebrada");
  });
});
