import { describe, expect, it } from "vitest";
import { err, isErr, isOk, map, ok, unwrapOr, type Result } from "./result";

describe("Result", () => {
  it("ok envuelve el valor", () => {
    const r = ok(42);
    expect(isOk(r)).toBe(true);
    expect(isErr(r)).toBe(false);
    expect(r.value).toBe(42);
  });

  it("err envuelve el error", () => {
    const r = err("boom");
    expect(isErr(r)).toBe(true);
    expect(r.error).toBe("boom");
  });

  it("map transforma solo el Ok", () => {
    expect(map(ok(2), (n: number) => n * 3)).toEqual(ok(6));
    const failed: Result<number, string> = err("x");
    expect(map(failed, (n: number) => n * 3)).toEqual(err("x"));
  });

  it("unwrapOr devuelve fallback en Err", () => {
    const failed: Result<string, string> = err("x");
    expect(unwrapOr(ok("a"), "z")).toBe("a");
    expect(unwrapOr(failed, "z")).toBe("z");
  });
});
