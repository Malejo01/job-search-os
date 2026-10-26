import pino from "pino";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { memoryCallSink } from "./calls";
import { createLlmClient } from "./client";
import { createProviderRegistry } from "./providers";
import { staticRouteSource } from "./router";
import type { RouteConfig, ThinkingLevel } from "./types";

// Sin red: un fetch falso captura el cuerpo que arma el AI SDK y responde por proveedor.
const silent = pino({ level: "silent" });
const Schema = z.object({ score: z.number(), veredicto: z.string() });
const vars = {
  profile_summary: "perfil",
  constraints: "restricciones",
  criteria: "criterios",
  job: "oferta",
  had_full_jd: false,
};

const HAIKU = "claude-haiku-5-5";
const GEMINI = "gemini-3.5-flash";

const route = (over: Partial<RouteConfig> = {}): RouteConfig => ({
  task: "evaluate_job",
  provider: "anthropic",
  model: HAIKU,
  fallbackModel: GEMINI,
  temperature: 0,
  maxTokens: 2048,
  thinkingLevel: "none",
  inputUsdPerMtok: 0.1,
  outputUsdPerMtok: 0.5,
  fallbackInputUsdPerMtok: 1.5,
  fallbackOutputUsdPerMtok: 9,
  ...over,
});

const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    // retry-after-ms bajo: el SDK reintenta 429/5xx/529 sin dormir segundos en el test
    headers: { "content-type": "application/json", "retry-after-ms": "1", ...headers },
  });

const anthropicOk = () =>
  json(200, {
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: HAIKU,
    content: [{ type: "text", text: JSON.stringify({ score: 7, veredicto: "bien" }) }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 20 },
  });

const geminiOk = () =>
  json(200, {
    candidates: [
      {
        content: {
          role: "model",
          parts: [{ text: JSON.stringify({ score: 5, veredicto: "gem" }) }],
        },
        finishReason: "STOP",
      },
    ],
    usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, totalTokenCount: 120 },
  });

type Seen = { url: string; body: Record<string, unknown> };

/** `anthropic` responde con lo que diga el guion (último se repite); Gemini siempre bien. */
function harness(anthropicScript: Array<() => Response>) {
  const seen: Seen[] = [];
  let n = 0;
  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    seen.push({ url, body });
    if (url.includes("anthropic")) {
      const step = anthropicScript[Math.min(n, anthropicScript.length - 1)]!;
      n += 1;
      return step();
    }
    return geminiOk();
  }) as typeof fetch;
  const calls = memoryCallSink();
  const client = createLlmClient({
    routes: staticRouteSource([route()]),
    calls,
    providers: createProviderRegistry(
      { ANTHROPIC_API_KEY: "k-test", GEMINI_API_KEY: "k-test" },
      { fetch: fakeFetch },
    ),
    logger: silent,
  });
  const toAnthropic = () => seen.filter((s) => s.url.includes("anthropic"));
  return { client, calls, seen, toAnthropic };
}

const errBody = (type: string, message: string) => ({ type: "error", error: { type, message } });

describe("petición a Anthropic (Haiku 5.5, sin red)", () => {
  it("manda output_config.format, sin sampling ni prefill, y thinking disabled con 'none'", async () => {
    const h = harness([anthropicOk]);
    const r = await h.client.generateStructured("evaluate_job", Schema, vars);
    expect(r).toMatchObject({ ok: true, value: { model: HAIKU, usedFallback: false } });

    const [req] = h.toAnthropic();
    expect(req).toBeDefined();
    const body = req!.body;
    const outputConfig = body.output_config as { format?: { type?: string }; effort?: string };
    expect(outputConfig.format?.type).toBe("json_schema");
    expect(outputConfig.effort).toBeUndefined();
    expect(body).not.toHaveProperty("temperature");
    expect(body).not.toHaveProperty("top_p");
    expect(body).not.toHaveProperty("top_k");
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(body.max_tokens).toBe(2048);
    // sin prefill: el último mensaje es del usuario
    const messages = body.messages as Array<{ role: string }>;
    expect(messages.at(-1)?.role).toBe("user");
    expect(messages.some((m) => m.role === "assistant")).toBe(false);
  });

  it("con thinking_level null no manda thinking (el default de la API manda): por eso las filas de Haiku llevan 'none'", async () => {
    const seen: Seen[] = [];
    const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
      seen.push({ url: String(input), body: JSON.parse(String(init?.body)) });
      return anthropicOk();
    }) as typeof fetch;
    const client = createLlmClient({
      routes: staticRouteSource([route({ thinkingLevel: null as ThinkingLevel | null })]),
      calls: memoryCallSink(),
      providers: createProviderRegistry({ ANTHROPIC_API_KEY: "k-test" }, { fetch: fakeFetch }),
      logger: silent,
    });
    await client.generateStructured("evaluate_job", Schema, vars);
    expect(seen[0]!.body).not.toHaveProperty("thinking");
  });

  it("Sonnet 5.5 hoy: sin temperature, sin thinking con null; con 'none' manda disabled", async () => {
    const run = async (thinkingLevel: ThinkingLevel | null) => {
      const seen: Seen[] = [];
      const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
        seen.push({ url: String(input), body: JSON.parse(String(init?.body)) });
        return anthropicOk();
      }) as typeof fetch;
      const client = createLlmClient({
        routes: staticRouteSource([
          route({
            model: "claude-sonnet-5-5",
            fallbackModel: null,
            temperature: 0.4,
            maxTokens: 800,
            thinkingLevel,
          }),
        ]),
        calls: memoryCallSink(),
        providers: createProviderRegistry({ ANTHROPIC_API_KEY: "k-test" }, { fetch: fakeFetch }),
        logger: silent,
      });
      await client.generateStructured("evaluate_job", Schema, vars);
      return seen[0]!.body;
    };
    const withNull = await run(null);
    expect(withNull).not.toHaveProperty("temperature"); // la 0,4 de la fila se descarta
    expect(withNull).not.toHaveProperty("thinking");
    expect(withNull.max_tokens).toBe(800);
    const withNone = await run("none");
    expect(withNone.thinking).toEqual({ type: "disabled" });
  });
});

describe("respaldo a Gemini desde Haiku (sin red)", () => {
  const cases: Array<[string, () => Response, string]> = [
    ["401", () => json(401, errBody("authentication_error", "x")), "api_call:401"],
    ["402 billing_error", () => json(402, errBody("billing_error", "x")), "api_call:402"],
    ["403", () => json(403, errBody("permission_error", "x")), "api_call:403"],
    ["404", () => json(404, errBody("not_found_error", "x")), "api_call:404"],
    ["429", () => json(429, errBody("rate_limit_error", "x")), "api_call:429"],
    ["500", () => json(500, errBody("api_error", "x")), "api_call:500"],
    ["529 overloaded", () => json(529, errBody("overloaded_error", "x")), "api_call:529"],
    [
      "400 crédito agotado",
      () =>
        json(
          400,
          errBody("invalid_request_error", "Your credit balance is too low to access the API."),
        ),
      "api_call:402",
    ],
    [
      "400 de validación (hoy también cae al respaldo)",
      () => json(400, errBody("invalid_request_error", "max_tokens: invalido")),
      "api_call:400",
    ],
  ];

  it.each(cases)("%s cae a Gemini y queda registrado como %s", async (_name, step, code) => {
    const h = harness([step]);
    const r = await h.client.generateStructured("evaluate_job", Schema, vars, { userId: "u1" });
    expect(r).toMatchObject({
      ok: true,
      value: { model: GEMINI, provider: "google", usedFallback: true },
    });
    expect(h.calls.calls.map((c) => [c.model, c.ok])).toEqual([
      [HAIKU, false],
      [GEMINI, true],
    ]);
    expect(h.calls.calls[0]!.error).toBe(code);
  });

  it("200 con stop_reason refusal cae a Gemini y queda registrado como refusal", async () => {
    const refusal = () =>
      json(200, {
        id: "msg_r",
        type: "message",
        role: "assistant",
        model: HAIKU,
        content: [],
        stop_reason: "refusal",
        stop_sequence: null,
        usage: { input_tokens: 100, output_tokens: 0 },
      });
    const h = harness([refusal]);
    const r = await h.client.generateStructured("evaluate_job", Schema, vars);
    expect(r).toMatchObject({ ok: true, value: { model: GEMINI, usedFallback: true } });
    expect(h.calls.calls.map((c) => [c.model, c.ok, c.error])).toEqual([
      [HAIKU, false, "refusal"],
      [GEMINI, true, null],
    ]);
  });

  it("si Anthropic responde bien no se toca Gemini", async () => {
    const h = harness([anthropicOk]);
    await h.client.generateStructured("evaluate_job", Schema, vars);
    expect(h.seen.every((s) => s.url.includes("anthropic"))).toBe(true);
  });
});
