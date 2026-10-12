import { describe, expect, it } from "vitest";
import { parsePoolLimits, POOL_LIMIT_DEFAULTS } from "./limits";

describe("parsePoolLimits", () => {
  it("sin variables usa los defaults", () => {
    expect(parsePoolLimits({})).toEqual({ limits: POOL_LIMIT_DEFAULTS, invalid: [] });
    expect(POOL_LIMIT_DEFAULTS).toEqual({
      firstAssignLimit: 30,
      firstEvalTopN: 9,
      dailyAssignLimit: 20,
      dailyEvalPerUser: 3,
    });
  });

  it("vacío o solo espacios cuenta como ausente, sin marcarlo inválido", () => {
    const r = parsePoolLimits({ POOL_FIRST_ASSIGN_LIMIT: "", FIRST_EVAL_TOP_N: "  " });
    expect(r.limits).toEqual(POOL_LIMIT_DEFAULTS);
    expect(r.invalid).toEqual([]);
  });

  it("lee enteros válidos y acepta 0 como apagado", () => {
    const r = parsePoolLimits({
      POOL_FIRST_ASSIGN_LIMIT: "50",
      FIRST_EVAL_TOP_N: "0",
      POOL_DAILY_ASSIGN_LIMIT: " 7 ",
      POOL_DAILY_EVAL_PER_USER: "500",
    });
    expect(r.limits).toEqual({
      firstAssignLimit: 50,
      firstEvalTopN: 0,
      dailyAssignLimit: 7,
      dailyEvalPerUser: 500,
    });
    expect(r.invalid).toEqual([]);
  });

  it.each(["abc", "-1", "1.5", "501", "1e2", "0x10", "9999999999"])(
    "valor inválido %j vuelve al default y se informa el nombre",
    (value) => {
      const r = parsePoolLimits({ POOL_DAILY_ASSIGN_LIMIT: value, FIRST_EVAL_TOP_N: "4" });
      expect(r.limits.dailyAssignLimit).toBe(20);
      expect(r.limits.firstEvalTopN).toBe(4);
      expect(r.invalid).toEqual(["POOL_DAILY_ASSIGN_LIMIT"]);
    },
  );

  it("informa todos los inválidos en orden estable", () => {
    const r = parsePoolLimits({
      POOL_DAILY_EVAL_PER_USER: "x",
      POOL_FIRST_ASSIGN_LIMIT: "-3",
    });
    expect(r.invalid).toEqual(["POOL_FIRST_ASSIGN_LIMIT", "POOL_DAILY_EVAL_PER_USER"]);
    expect(r.limits).toEqual(POOL_LIMIT_DEFAULTS);
  });
});
