import { describe, expect, it } from "vitest";
import { DEFAULT_DB_POOL_MAX, parseDbPoolMax } from "./pool-max";

describe("parseDbPoolMax (R8-4)", () => {
  it("sin variable o vacía: default 5, sin marcar inválido", () => {
    expect(parseDbPoolMax(undefined)).toEqual({ max: DEFAULT_DB_POOL_MAX, invalid: false });
    expect(parseDbPoolMax("  ")).toEqual({ max: 5, invalid: false });
  });

  it("enteros de 1 a 20", () => {
    expect(parseDbPoolMax("1")).toEqual({ max: 1, invalid: false });
    expect(parseDbPoolMax(" 8 ")).toEqual({ max: 8, invalid: false });
    expect(parseDbPoolMax("20")).toEqual({ max: 20, invalid: false });
  });

  it.each(["0", "21", "-3", "2.5", "abc", "5e1", "0x10"])(
    "%s: default y marcado inválido",
    (raw) => {
      expect(parseDbPoolMax(raw)).toEqual({ max: 5, invalid: true });
    },
  );
});
