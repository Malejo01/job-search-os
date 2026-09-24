import pino from "pino";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { memoryCallSink } from "./calls";
import { createLlmClient } from "./client";
import { createFakeLlm } from "./fake";
import { cachedRouteSource, staticRouteSource } from "./router";
import type { GenerateFn, ProviderRegistry, RouteConfig } from "./types";

const silent = pino({ level: "silent" });
const Schema = z.object({ score: z.number(), veredicto: z.string() });

const route: RouteConfig = {
  task: "evaluate_job",
  provider: "google",
  model: "modelo-primario",
  fallbackModel: "claude-fallback",
  temperature: 0,
  maxTokens: 512,
  thinkingLevel: null,
  inputUsdPerMtok: 1,
  outputUsdPerMtok: 10,
  fallbackInputUsdPerMtok: null,
  fallbackOutputUsdPerMtok: null,
};

const vars = {
  profile_summary: "perfil",
  constraints: "restricciones",
  criteria: "criterios",
  job: "oferta",
  had_full_jd: false,
};

/** Registro que devuelve un modelo "de cartón" salvo para los proveedores sin key. */
const providers = (available: string[]): ProviderRegistry => ({
  modelFor: (provider, model) =>
    available.includes(provider) ? ({ modelId: model } as never) : null,
});

const okGenerate =
  (object: unknown, usage = { inputTokens: 1000, outputTokens: 100 }): GenerateFn =>
  async () => ({ object, usage });

describe("createLlmClient.generateStructured", () => {
  it("renderiza el prompt, valida el schema y registra la llamada con costo", async () => {
    const calls = memoryCallSink();
    let seenPrompt = "";
    const generate: GenerateFn = async (args) => {
      seenPrompt = args.prompt;
      expect(args.temperature).toBe(0);
      expect(args.maxOutputTokens).toBe(512);
      return {
        object: { score: 7, veredicto: "bien" },
        usage: { inputTokens: 1000, outputTokens: 100 },
      };
    };
    const client = createLlmClient({
      routes: staticRouteSource([route]),
      calls,
      providers: providers(["google"]),
      generate,
      logger: silent,
    });

    const r = await client.generateStructured("evaluate_job", Schema, vars, {
      userId: "u1",
      jobId: "j1",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.object).toEqual({ score: 7, veredicto: "bien" });
    expect(r.value.model).toBe("modelo-primario");
    expect(r.value.promptVersion).toBe("evaluate_job@v1.3.2");
    expect(r.value.usedFallback).toBe(false);
    expect(seenPrompt).toContain("perfil");
    expect(seenPrompt).toContain("had_full_jd: false");
    expect(seenPrompt).not.toContain("{{");

    expect(calls.calls).toHaveLength(1);
    expect(calls.calls[0]).toMatchObject({
      userId: "u1",
      jobId: "j1",
      task: "evaluate_job",
      model: "modelo-primario",
      promptVersion: "evaluate_job@v1.3.2",
      tokensIn: 1000,
      tokensOut: 100,
      ok: true,
      error: null,
    });
    // 1000 × 1 + 100 × 10 = 2000 → /1e6
    expect(calls.calls[0]!.costUsd).toBeCloseTo(0.002, 9);
  });

  it("falla con no_route si la tarea no está en model_routing", async () => {
    const client = createLlmClient({
      routes: staticRouteSource([]),
      calls: memoryCallSink(),
      providers: providers(["google"]),
      generate: okGenerate({}),
      logger: silent,
    });
    const r = await client.generateStructured("otra_tarea", Schema, vars);
    expect(r).toMatchObject({ ok: false, error: { kind: "no_route", task: "otra_tarea" } });
  });

  it("falla con prompt si falta una variable y no llama al modelo", async () => {
    let called = false;
    const client = createLlmClient({
      routes: staticRouteSource([route]),
      calls: memoryCallSink(),
      providers: providers(["google"]),
      generate: async () => {
        called = true;
        return { object: {}, usage: {} };
      },
      logger: silent,
    });
    const r = await client.generateStructured("evaluate_job", Schema, { job: "x" });
    expect(r).toMatchObject({ ok: false, error: { kind: "prompt" } });
    expect(called).toBe(false);
  });

  it("si el primario falla usa el fallback y registra ambas llamadas", async () => {
    const calls = memoryCallSink();
    const generate: GenerateFn = async (args) => {
      if ((args.model as unknown as { modelId: string }).modelId === "modelo-primario") {
        throw new Error("429 rate limited");
      }
      return {
        object: { score: 5, veredicto: "fallback" },
        usage: { inputTokens: 10, outputTokens: 5 },
      };
    };
    const client = createLlmClient({
      routes: staticRouteSource([route]),
      calls,
      providers: providers(["google", "anthropic"]),
      generate,
      logger: silent,
    });
    const r = await client.generateStructured("evaluate_job", Schema, vars);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.model).toBe("claude-fallback");
    expect(r.value.provider).toBe("anthropic");
    expect(r.value.usedFallback).toBe(true);
    expect(calls.calls.map((c) => [c.model, c.ok])).toEqual([
      ["modelo-primario", false],
      ["claude-fallback", true],
    ]);
    expect(calls.calls[0]!.error).toContain("429");
    expect(calls.calls[1]!.costUsd).toBeNull(); // sin precio para el fallback
  });

  it("registra los tokens de thinking aparte y los cobra como salida", async () => {
    const calls = memoryCallSink();
    const client = createLlmClient({
      routes: staticRouteSource([{ ...route, fallbackModel: null }]),
      calls,
      providers: providers(["google"]),
      generate: async () => ({
        object: { score: 7, veredicto: "ok" },
        // Como el SDK con Gemini: outputTokens = texto + thoughts; reasoningTokens = thoughts
        usage: { inputTokens: 1000, outputTokens: 2000, reasoningTokens: 1700 },
      }),
      logger: silent,
    });
    const r = await client.generateStructured("evaluate_job", Schema, vars);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.usage).toEqual({ inputTokens: 1000, outputTokens: 2000, reasoningTokens: 1700 });
    expect(calls.calls[0]).toMatchObject({ tokensOut: 2000, tokensReasoning: 1700 });
    // 1000 × 1 + 2000 × 10 (el thinking va a tarifa de salida) = 21000 → /1e6
    expect(r.value.costUsd).toBeCloseTo(0.021, 9);
  });

  it("cobra el fallback con su propia tarifa cuando model_routing la tiene", async () => {
    const calls = memoryCallSink();
    const client = createLlmClient({
      routes: staticRouteSource([
        { ...route, fallbackInputUsdPerMtok: 2, fallbackOutputUsdPerMtok: 20 },
      ]),
      calls,
      providers: providers(["google", "anthropic"]),
      generate: async (args) => {
        if ((args.model as unknown as { modelId: string }).modelId === "modelo-primario") {
          throw new Error("500");
        }
        return {
          object: { score: 5, veredicto: "fb" },
          usage: { inputTokens: 100, outputTokens: 10 },
        };
      },
      logger: silent,
    });
    const r = await client.generateStructured("evaluate_job", Schema, vars);
    expect(r.ok && r.value.costUsd).toBeCloseTo((100 * 2 + 10 * 20) / 1e6, 12);
    expect(calls.calls[1]!.costUsd).toBeCloseTo(0.0004, 12);
  });

  it("corta la llamada por timeout y la registra como fallida sin tokens", async () => {
    const calls = memoryCallSink();
    const client = createLlmClient({
      routes: staticRouteSource([{ ...route, fallbackModel: null }]),
      calls,
      providers: providers(["google"]),
      callTimeoutMs: 20,
      // Proveedor colgado: solo termina cuando lo abortan
      generate: (args) =>
        new Promise((_, reject) => {
          args.abortSignal?.addEventListener("abort", () =>
            reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
          );
        }),
      logger: silent,
    });
    const r = await client.generateStructured("evaluate_job", Schema, vars);
    expect(r).toMatchObject({ ok: false, error: { kind: "aborted" } });
    if (r.ok) return;
    expect(r.error.detail).toContain("timeout de 20 ms");
    expect(calls.calls[0]).toMatchObject({ ok: false, tokensIn: null, tokensOut: null });
  });

  it("una señal externa cancela la llamada y NO prueba el fallback", async () => {
    const calls = memoryCallSink();
    const controller = new AbortController();
    const client = createLlmClient({
      routes: staticRouteSource([route]),
      calls,
      providers: providers(["google", "anthropic"]),
      generate: (args) =>
        new Promise((_, reject) => {
          args.abortSignal?.addEventListener("abort", () =>
            reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
          );
          controller.abort(new Error("SIGINT"));
        }),
      logger: silent,
    });
    const r = await client.generateStructured("evaluate_job", Schema, vars, {
      signal: controller.signal,
    });
    expect(r).toMatchObject({ ok: false, error: { kind: "aborted" } });
    if (r.ok) return;
    expect(r.error.detail).toContain("señal externa");
    expect(calls.calls.map((c) => c.model)).toEqual(["modelo-primario"]);
  });

  it("si el fallback no tiene API key devuelve el error del primario", async () => {
    const calls = memoryCallSink();
    const client = createLlmClient({
      routes: staticRouteSource([route]),
      calls,
      providers: providers(["google"]),
      generate: async () => {
        throw new Error("boom");
      },
      logger: silent,
    });
    const r = await client.generateStructured("evaluate_job", Schema, vars);
    expect(r).toMatchObject({ ok: false, error: { kind: "generation_failed" } });
    if (r.ok) return;
    expect(r.error.detail).toContain("boom");
    expect(calls.calls).toHaveLength(1);
  });

  it("no re-parsea una salida ya validada por el proveedor (schema con transform)", async () => {
    const WithTransform = z
      .object({ gaps: z.array(z.string()) })
      .transform((e) => ({ gaps: e.gaps.map((skill) => ({ skill, nivel: "must" as const })) }));
    const client = createLlmClient({
      routes: staticRouteSource([{ ...route, fallbackModel: null }]),
      calls: memoryCallSink(),
      providers: providers(["google"]),
      // Como generateObject: devuelve la SALIDA del schema, ya transformada
      generate: async () => ({
        object: { gaps: [{ skill: "aws", nivel: "must" }] },
        usage: {},
        validated: true,
      }),
      logger: silent,
    });
    const r = await client.generateStructured("evaluate_job", WithTransform, vars);
    expect(r).toMatchObject({
      ok: true,
      value: { object: { gaps: [{ skill: "aws", nivel: "must" }] } },
    });
  });

  it("rechaza una salida que no cumple el schema", async () => {
    const calls = memoryCallSink();
    const client = createLlmClient({
      routes: staticRouteSource([{ ...route, fallbackModel: null }]),
      calls,
      providers: providers(["google"]),
      generate: okGenerate({ score: "siete" }),
      logger: silent,
    });
    const r = await client.generateStructured("evaluate_job", Schema, vars);
    expect(r).toMatchObject({ ok: false, error: { kind: "generation_failed" } });
    expect(calls.calls[0]!.ok).toBe(false);
  });
});

describe("cachedRouteSource", () => {
  it("cachea 5 minutos y refresca después", async () => {
    let reads = 0;
    let clock = 0;
    const inner = { getRoute: async () => (reads++, route) };
    const cached = cachedRouteSource(inner, { now: () => clock });
    await cached.getRoute("evaluate_job");
    await cached.getRoute("evaluate_job");
    expect(reads).toBe(1);
    clock = 5 * 60 * 1000 + 1;
    await cached.getRoute("evaluate_job");
    expect(reads).toBe(2);
  });
});

describe("createFakeLlm", () => {
  it("devuelve la respuesta grabada validada y registra la llamada", async () => {
    const fake = createFakeLlm({ evaluate_job: { score: 8, veredicto: "grabada" } });
    const r = await fake.generateStructured("evaluate_job", Schema, vars, { jobId: "j9" });
    expect(r).toMatchObject({ ok: true, value: { object: { score: 8 }, provider: "fake" } });
    expect(fake.calls[0]).toMatchObject({ task: "evaluate_job", ctx: { jobId: "j9" } });
  });

  it("falla si la respuesta grabada no cumple el schema", async () => {
    const fake = createFakeLlm({ evaluate_job: { score: "x" } });
    const r = await fake.generateStructured("evaluate_job", Schema, vars);
    expect(r).toMatchObject({ ok: false, error: { kind: "generation_failed" } });
  });
});

describe("thinking_level y registro de evals", () => {
  it("pasa thinking_level como `reasoning` al SDK y registra task/label de la corrida", async () => {
    const calls = memoryCallSink();
    let seen: unknown;
    const client = createLlmClient({
      routes: staticRouteSource([{ ...route, fallbackModel: null, thinkingLevel: "minimal" }]),
      calls,
      providers: providers(["google"]),
      generate: async (args) => {
        seen = args.reasoning;
        return {
          object: { score: 7, veredicto: "ok" },
          usage: { inputTokens: 1, outputTokens: 1 },
        };
      },
      logger: silent,
    });
    const r = await client.generateStructured("evaluate_job", Schema, vars, {
      recordTask: "eval:v1.2",
      label: "paso4",
    });
    expect(r.ok).toBe(true);
    expect(seen).toBe("minimal");
    expect(calls.calls[0]).toMatchObject({ task: "eval:v1.2", label: "paso4", ok: true });
  });

  it("sin thinking_level no manda `reasoning` (default del proveedor) y label queda null", async () => {
    const calls = memoryCallSink();
    let seen: unknown = "x";
    const client = createLlmClient({
      routes: staticRouteSource([{ ...route, fallbackModel: null }]),
      calls,
      providers: providers(["google"]),
      generate: async (args) => {
        seen = args.reasoning;
        return { object: { score: 7, veredicto: "ok" }, usage: {} };
      },
      logger: silent,
    });
    await client.generateStructured("evaluate_job", Schema, vars);
    expect(seen).toBeUndefined();
    expect(calls.calls[0]).toMatchObject({ task: "evaluate_job", label: null });
  });
});
