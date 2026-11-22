import { describe, expect, it } from "vitest";
import { z } from "zod";
import pino from "pino";
import { memoryCallSink } from "./calls";
import { createLlmClient } from "./client";
import { capabilitiesFor, reasoningFor, UNKNOWN_MODEL_CAPABILITIES } from "./model-capabilities";
import { staticRouteSource } from "./router";
import type { GenerateFn, ProviderRegistry, RouteConfig } from "./types";

const silent = pino({ level: "silent" });
const Schema = z.object({ score: z.number(), veredicto: z.string() });
const vars = {
  profile_summary: "perfil",
  constraints: "restricciones",
  criteria: "criterios",
  job: "oferta",
  had_full_jd: false,
};
const providers: ProviderRegistry = {
  modelFor: (_provider, model) => ({ modelId: model }) as never,
};

const baseRoute: RouteConfig = {
  task: "evaluate_job",
  provider: "anthropic",
  model: "claude-sonnet-5-5",
  fallbackModel: "gemini-3.5-flash",
  temperature: 0.3,
  maxTokens: 512,
  thinkingLevel: null,
  inputUsdPerMtok: 2,
  outputUsdPerMtok: 10,
  fallbackInputUsdPerMtok: 1.5,
  fallbackOutputUsdPerMtok: 9,
};

type Seen = { model: string; temperature: number | undefined; reasoning: unknown };

/** Registra lo que recibe el SDK; el primer intento falla para que entre el respaldo. */
function harness(route: RouteConfig, failFirst: boolean) {
  const seen: Seen[] = [];
  const generate: GenerateFn = async (args) => {
    seen.push({
      model: (args.model as unknown as { modelId: string }).modelId,
      temperature: args.temperature,
      reasoning: args.reasoning,
    });
    if (failFirst && seen.length === 1) throw new Error("falla");
    return { object: { score: 1, veredicto: "ok" }, usage: { inputTokens: 1, outputTokens: 1 } };
  };
  const client = createLlmClient({
    routes: staticRouteSource([route]),
    calls: memoryCallSink(),
    providers,
    generate,
    logger: silent,
  });
  return { seen, client };
}

describe("capabilitiesFor", () => {
  it("conoce los modelos del seed", () => {
    expect(capabilitiesFor("claude-sonnet-5-5").temperature).toBe(false);
    expect(capabilitiesFor("claude-haiku-4-5").temperature).toBe(true);
    expect(capabilitiesFor("gemini-3.5-flash")).toMatchObject({ thinking: true, images: true });
    expect(capabilitiesFor("gemini-3.1-flash-lite").thinking).toBe(true);
  });

  it("un modelo desconocido falla cerrado: sin parámetros opcionales ni imágenes", () => {
    expect(capabilitiesFor("modelo-nuevo")).toEqual(UNKNOWN_MODEL_CAPABILITIES);
    expect(capabilitiesFor("constructor")).toEqual(UNKNOWN_MODEL_CAPABILITIES);
    expect(capabilitiesFor("__proto__")).toEqual(UNKNOWN_MODEL_CAPABILITIES);
    expect(UNKNOWN_MODEL_CAPABILITIES).toEqual({
      temperature: false,
      thinking: false,
      fallbackThinking: null,
      images: false,
    });
  });
});

describe("reasoningFor", () => {
  it("solo manda razonamiento a modelos que lo aceptan", () => {
    expect(reasoningFor("modelo-nuevo", "low", false)).toBeUndefined();
    expect(reasoningFor("claude-sonnet-5-5", "none", false)).toBe("none");
    expect(reasoningFor("claude-sonnet-5-5", null, true)).toBeUndefined();
    expect(reasoningFor("gemini-3.5-flash", "low", false)).toBe("low");
  });

  it("de respaldo en Google sin valor en la fila usa minimal; de principal no inventa", () => {
    expect(reasoningFor("gemini-3.5-flash", null, true)).toBe("minimal");
    expect(reasoningFor("gemini-3.5-flash", null, false)).toBeUndefined();
  });
});

describe("el cliente respeta las capacidades del modelo", () => {
  it("no manda temperature a un modelo que no la acepta y sí al respaldo que la acepta", async () => {
    const { seen, client } = harness(baseRoute, true);
    const r = await client.generateStructured("evaluate_job", Schema, vars);
    expect(r.ok).toBe(true);
    expect(seen).toEqual([
      { model: "claude-sonnet-5-5", temperature: undefined, reasoning: undefined },
      { model: "gemini-3.5-flash", temperature: 0.3, reasoning: "minimal" },
    ]);
  });

  it("manda temperature a un modelo de Anthropic que la acepta", async () => {
    const { seen, client } = harness(
      { ...baseRoute, model: "claude-haiku-4-5", fallbackModel: null },
      false,
    );
    await client.generateStructured("evaluate_job", Schema, vars);
    expect(seen[0]).toMatchObject({ temperature: 0.3, reasoning: undefined });
  });

  it("un modelo fuera de la tabla no recibe temperature ni razonamiento", async () => {
    const { seen, client } = harness(
      { ...baseRoute, model: "modelo-nuevo", fallbackModel: null, thinkingLevel: "low" },
      false,
    );
    const r = await client.generateStructured("evaluate_job", Schema, vars);
    expect(r.ok).toBe(true);
    expect(seen[0]).toEqual({
      model: "modelo-nuevo",
      temperature: undefined,
      reasoning: undefined,
    });
  });

  it("el principal Google usa el thinking_level de la fila", async () => {
    const { seen, client } = harness(
      {
        ...baseRoute,
        provider: "google",
        model: "gemini-3.5-flash",
        fallbackModel: null,
        thinkingLevel: "low",
      },
      false,
    );
    await client.generateStructured("evaluate_job", Schema, vars);
    expect(seen[0]).toMatchObject({ temperature: 0.3, reasoning: "low" });
  });

  it("no manda una imagen a un modelo sin capacidad de imagen y no llama al proveedor", async () => {
    const { seen, client } = harness(
      { ...baseRoute, model: "modelo-nuevo", fallbackModel: null },
      false,
    );
    const r = await client.generateStructured("evaluate_job", Schema, vars, {
      images: [{ mediaType: "image/jpeg", data: new Uint8Array([1]) }],
    });
    expect(r).toMatchObject({ ok: false, error: { kind: "generation_failed" } });
    expect(seen).toHaveLength(0);
  });

  it("con imagen y principal Claude manda el bloque de imagen tal cual", async () => {
    const { seen, client } = harness({ ...baseRoute, fallbackModel: null }, false);
    const r = await client.generateStructured("evaluate_job", Schema, vars, {
      images: [{ mediaType: "image/jpeg", data: new Uint8Array([1]) }],
    });
    expect(r.ok).toBe(true);
    expect(seen).toHaveLength(1);
  });
});
