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
    expect(normalizeLlmError(e)).toBe("no_object");
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
