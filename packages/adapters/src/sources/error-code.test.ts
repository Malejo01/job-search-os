import { describe, expect, it } from "vitest";
import { describeFailure, sourceErrorCode } from "./error-code";

describe("sourceErrorCode", () => {
  it("clasifica en una lista cerrada", () => {
    expect(sourceErrorCode(new Error("x: HTTP 429"))).toBe("http_429");
    expect(sourceErrorCode(new Error("x: HTTP 404"))).toBe("http_4xx");
    expect(sourceErrorCode(new Error("x: HTTP 502"))).toBe("http_5xx");
    expect(sourceErrorCode(new SyntaxError("Unexpected token"))).toBe("parse");
    expect(sourceErrorCode(new Error("timeout de la fuente"))).toBe("timeout");
    expect(sourceErrorCode(Object.assign(new Error("a"), { name: "AbortError" }))).toBe("timeout");
    expect(sourceErrorCode(new Error("otra cosa"))).toBe("unknown");
    expect(sourceErrorCode("texto", true)).toBe("timeout");
  });
});

describe("describeFailure", () => {
  it("categorías cerradas, sin el mensaje original", () => {
    const leak = new SyntaxError('Unexpected token < in JSON at position 0: "<html>dato-privado');
    expect(describeFailure(leak)).toBe("respuesta no es JSON");
    expect(describeFailure(new Error("Jobicy: HTTP 503"))).toBe("HTTP 503");
    expect(describeFailure(new Error("timeout de la fuente"))).toBe("timeout");
    expect(describeFailure(new TypeError("fetch failed: dato-privado"))).toBe("error de red");
    expect(describeFailure(new Error("Failed query: params dato-privado"))).toBe(
      "error desconocido",
    );
    expect(describeFailure("x")).toBe("error desconocido");
    for (const e of [leak, new TypeError("fetch failed: dato-privado")]) {
      expect(describeFailure(e)).not.toContain("dato-privado");
    }
  });
});
