import { APICallError, NoObjectGeneratedError, RetryError } from "ai";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { isLlmErrorCode, LlmValidationError, normalizeLlmError } from "./error-code";

const apiError = (statusCode: number | undefined, message = "TEXTO-DEL-JD") =>
  new APICallError({ message, url: "https://x.test", requestBodyValues: {}, statusCode });

describe("normalizeLlmError", () => {
  it("api_call con status, sin el message", () => {
    const code = normalizeLlmError(apiError(500));
    expect(code).toBe("api_call:500");
    expect(code).not.toContain("TEXTO-DEL-JD");
  });

  it("api_call sin status válido", () => {
    expect(normalizeLlmError(apiError(undefined))).toBe("api_call");
    expect(normalizeLlmError(apiError(42))).toBe("api_call");
  });

  it("crédito agotado: 400 con la frase acotada o billing_error van a api_call:402", () => {
    const body = (message: string, type = "invalid_request_error") =>
      JSON.stringify({ type: "error", error: { type, message } });
    const withBody = (statusCode: number, responseBody: string, data?: unknown) =>
      new APICallError({
        message: "TEXTO-DEL-JD",
        url: "https://x.test",
        requestBodyValues: {},
        statusCode,
        responseBody,
        data,
      });
    const depleted = body("Your credit balance is too low to access the Anthropic API.");
    expect(normalizeLlmError(withBody(400, depleted))).toBe("api_call:402");
    expect(normalizeLlmError(withBody(400, "", { error: { type: "billing_error" } }))).toBe(
      "api_call:402",
    );
    expect(normalizeLlmError(withBody(402, body("x", "billing_error")))).toBe("api_call:402");
    // un 400 de validación sigue siendo 400, y la frase en otro status no cambia nada
    expect(normalizeLlmError(withBody(400, body("max_tokens: must be positive")))).toBe(
      "api_call:400",
    );
    expect(normalizeLlmError(withBody(500, depleted))).toBe("api_call:500");
    expect(normalizeLlmError(withBody(400, depleted))).not.toContain("credit");
  });

  it("desenvuelve el RetryError al último error del proveedor", () => {
    const retry = new RetryError({
      message: "Failed after 3 attempts. Last error: TEXTO-DEL-JD",
      reason: "maxRetriesExceeded",
      errors: [apiError(429), apiError(429)],
    });
    expect(normalizeLlmError(retry)).toBe("api_call:429");
  });

  it("no_object", () => {
    const e = new NoObjectGeneratedError({
      message: "TEXTO-DEL-JD",
      text: "TEXTO-DEL-JD",
      response: { id: "r", timestamp: new Date(), modelId: "m" },
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } as never,
      finishReason: "length",
    });
    expect(normalizeLlmError(e)).toBe("no_object:finish:length");
    const refused = new NoObjectGeneratedError({
      message: "TEXTO-DEL-JD",
      response: { id: "r", timestamp: new Date(), modelId: "m" },
      usage: { inputTokens: 1, outputTokens: 0, totalTokens: 1 } as never,
      finishReason: "content-filter",
    });
    expect(normalizeLlmError(refused)).toBe("refusal");
    expect(isLlmErrorCode("refusal")).toBe(true);
  });

  describe("motivo de no_object", () => {
    const noObject = (cause: Error | undefined, finishReason: "stop" | "length" = "stop") =>
      new NoObjectGeneratedError({
        message: "TEXTO-DEL-JD",
        text: "TEXTO-DEL-JD",
        cause,
        response: { id: "r", timestamp: new Date(), modelId: "m" },
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } as never,
        finishReason,
      });
    const zodCause = (schema: z.ZodType, value: unknown) => schema.safeParse(value).error;

    it("too_big, too_small e invalid_type llevan el campo", () => {
      const schema = z.object({
        veredicto: z.string().max(3),
        gaps: z.array(z.string()).min(2),
        score: z.number(),
      });
      expect(
        normalizeLlmError(
          noObject(zodCause(schema, { veredicto: "largo", gaps: ["a", "b"], score: 1 })),
        ),
      ).toBe("no_object:too_big:veredicto");
      expect(
        normalizeLlmError(noObject(zodCause(schema, { veredicto: "a", gaps: ["a"], score: 1 }))),
      ).toBe("no_object:too_small:gaps");
      expect(
        normalizeLlmError(
          noObject(zodCause(schema, { veredicto: "a", gaps: ["a", "b"], score: "x" })),
        ),
      ).toBe("no_object:invalid_type:score");
    });

    it("encuentra el ZodError un nivel más abajo en la cadena de cause", () => {
      const inner = zodCause(z.object({ score: z.number().max(10) }), { score: 11 });
      const wrapped = Object.assign(new Error("TEXTO-DEL-JD"), { cause: inner });
      expect(normalizeLlmError(noObject(wrapped))).toBe("no_object:too_big:score");
    });

    it("JSON mal formado es parse; sin causa, el finishReason", () => {
      const parse = Object.assign(new Error("TEXTO-DEL-JD"), { name: "AI_JSONParseError" });
      expect(normalizeLlmError(noObject(parse))).toBe("no_object:parse");
      expect(normalizeLlmError(noObject(undefined, "length"))).toBe("no_object:finish:length");
    });

    it("un nombre de campo raro no se copia", () => {
      const schema = z.record(z.string(), z.string().max(1));
      const code = normalizeLlmError(noObject(zodCause(schema, { "TEXTO DEL JD": "xx" })));
      expect(code).toBe("no_object:too_big:root");
      expect(code).not.toContain("JD");
    });

    it("todos cumplen el patrón cerrado", () => {
      for (const c of [
        "no_object",
        "no_object:too_big:veredicto",
        "no_object:too_small:gaps",
        "no_object:invalid_type:score",
        "no_object:parse",
        "no_object:finish:length",
        "no_object:finish:content-filter",
      ]) {
        expect(isLlmErrorCode(c)).toBe(true);
      }
      expect(isLlmErrorCode("no_object:too_big:Texto Libre")).toBe(false);
      expect(isLlmErrorCode("no_object:otro")).toBe(false);
    });
  });

  it("validation lleva solo los code de zod, sin paths ni valores", () => {
    const r = z.object({ clave: z.number() }).safeParse({ clave: "TEXTO-DEL-JD" });
    if (r.success) throw new Error("debía fallar");
    const code = normalizeLlmError(new LlmValidationError(r.error.issues));
    expect(code).toBe("validation:invalid_type");
  });

  it("timeout y abort por nombre", () => {
    expect(normalizeLlmError(Object.assign(new Error("x"), { name: "TimeoutError" }))).toBe(
      "timeout",
    );
    expect(normalizeLlmError(Object.assign(new Error("x"), { name: "AbortError" }))).toBe(
      "aborted",
    );
  });

  it("lo demás es unknown, aunque el message mencione un status", () => {
    expect(normalizeLlmError(new Error("429 rate limited"))).toBe("unknown");
    expect(normalizeLlmError("texto suelto")).toBe("unknown");
    expect(normalizeLlmError(null)).toBe("unknown");
  });

  it("todo código producido cumple el patrón cerrado", () => {
    const samples = [
      apiError(503),
      apiError(undefined),
      new Error("x"),
      new LlmValidationError([{ code: "too_small" }, { code: "invalid_type" }]),
    ].map(normalizeLlmError);
    for (const s of [...samples, "no_route", "provider_unavailable", "timeout", "aborted"]) {
      expect(isLlmErrorCode(s)).toBe(true);
    }
    expect(isLlmErrorCode("Error: algo con texto")).toBe(false);
  });
});
