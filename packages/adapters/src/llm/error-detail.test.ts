import { APICallError } from "ai";
import pino from "pino";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { memoryCallSink } from "./calls";
import { createLlmClient } from "./client";
import { staticRouteSource } from "./router";
import type { GenerateFn, ProviderRegistry, RouteConfig } from "./types";

// Copia LITERAL de evals/src/run.ts (PER_MINUTE_QUOTA, FATAL_ERROR, classifyError). Si cambian
// allá, este test avisa que `LlmError.detail` dejó de clasificar igual.
const PER_MINUTE_QUOTA = /PerMinute|per minute|requests per minute/i;
const FATAL_ERROR =
  /credits are depleted|PerDay|per day|daily|billing (account|is not|not enabled|disabled)|API key not valid|API_KEY_INVALID|PERMISSION_DENIED|salida no cumple el schema/i;
function classifyError(detail: string): "fatal" | "rate_limit" | "retry" {
  if (PER_MINUTE_QUOTA.test(detail)) return "rate_limit";
  return FATAL_ERROR.test(detail) ? "fatal" : "retry";
}

const route: RouteConfig = {
  task: "evaluate_job",
  provider: "google",
  model: "m",
  fallbackModel: null,
  temperature: 0,
  maxTokens: 512,
  thinkingLevel: null,
  inputUsdPerMtok: null,
  outputUsdPerMtok: null,
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
const providers: ProviderRegistry = { modelFor: (_p, model) => ({ modelId: model }) as never };
const api = (statusCode: number): GenerateFn => {
  return async () => {
    throw new APICallError({
      message: "TEXTO-DEL-JD",
      url: "https://x.test",
      requestBodyValues: {},
      statusCode,
    });
  };
};

async function run(generate: GenerateFn) {
  const calls = memoryCallSink();
  const client = createLlmClient({
    routes: staticRouteSource([route]),
    calls,
    providers,
    generate,
    logger: pino({ level: "silent" }),
  });
  const r = await client.generateStructured("evaluate_job", z.object({ score: z.number() }), vars);
  if (r.ok) throw new Error("debía fallar");
  return { detail: r.error.detail, stored: calls.calls[0]!.error };
}

describe("LlmError.detail conserva la clasificación de evals; llm_calls.error solo el código", () => {
  const cases: [string, GenerateFn, string, "fatal" | "rate_limit" | "retry"][] = [
    ["401", api(401), "api_call:401", "fatal"],
    ["403", api(403), "api_call:403", "fatal"],
    ["402", api(402), "api_call:402", "fatal"],
    ["429", api(429), "api_call:429", "rate_limit"],
    ["500", api(500), "api_call:500", "retry"],
    ["503", api(503), "api_call:503", "retry"],
    [
      "validación",
      async () => ({ object: { score: "x" }, usage: {} }),
      "validation:invalid_type",
      "fatal",
    ],
    [
      "error sin clasificar",
      async () => {
        throw new Error("boom");
      },
      "unknown",
      "retry",
    ],
  ];

  it.each(cases)("%s", async (_n, generate, code, expected) => {
    const { detail, stored } = await run(generate);
    expect(stored).toBe(code);
    expect(detail.startsWith(code)).toBe(true);
    expect(detail).not.toContain("TEXTO-DEL-JD");
    expect(classifyError(detail)).toBe(expected);
  });
});
