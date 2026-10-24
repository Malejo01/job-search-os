import { describe, expect, it } from "vitest";
import { DATA_CACHE_MAX_BYTES, fitCacheValue, jsonByteLength } from "./cache-limit";

describe("jsonByteLength", () => {
  it("mide bytes UTF-8 del JSON, no caracteres", () => {
    expect(jsonByteLength({ a: "x" })).toBe('{"a":"x"}'.length);
    // «ñ» ocupa 2 bytes en UTF-8
    expect(jsonByteLength("ñ")).toBe(4);
  });
});

describe("fitCacheValue", () => {
  const shrink = (v: { big: string; small: string }) => ({ big: "", small: v.small });

  it("deja el valor igual si entra", () => {
    const value = { big: "abc", small: "ok" };
    expect(fitCacheValue(value, shrink, 1000)).toBe(value);
  });

  it("achica el valor si se pasa del tope", () => {
    const value = { big: "x".repeat(200), small: "ok" };
    expect(fitCacheValue(value, shrink, 100)).toEqual({ big: "", small: "ok" });
  });

  it("el tope por defecto deja margen bajo los 2 MB del Data Cache de Next", () => {
    expect(DATA_CACHE_MAX_BYTES).toBeLessThan(2 * 1024 * 1024);
  });
});
