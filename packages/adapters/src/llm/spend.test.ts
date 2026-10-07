import { describe, expect, it } from "vitest";
import { DEFAULT_USER_DAILY_CAP_USD, userDailyCapUsd } from "./spend";

describe("userDailyCapUsd (LLM_USER_DAILY_CAP_USD)", () => {
  it("sin variable o vacía usa el default", () => {
    expect(userDailyCapUsd({})).toBe(DEFAULT_USER_DAILY_CAP_USD);
    expect(userDailyCapUsd({ LLM_USER_DAILY_CAP_USD: "" })).toBe(DEFAULT_USER_DAILY_CAP_USD);
    expect(DEFAULT_USER_DAILY_CAP_USD).toBe(1);
  });

  it("lee el valor y acepta 0 (sin tope)", () => {
    expect(userDailyCapUsd({ LLM_USER_DAILY_CAP_USD: "0.5" })).toBe(0.5);
    expect(userDailyCapUsd({ LLM_USER_DAILY_CAP_USD: "0" })).toBe(0);
  });

  it("rechaza valores inválidos", () => {
    expect(() => userDailyCapUsd({ LLM_USER_DAILY_CAP_USD: "abc" })).toThrow(
      /LLM_USER_DAILY_CAP_USD/,
    );
    expect(() => userDailyCapUsd({ LLM_USER_DAILY_CAP_USD: "-1" })).toThrow(
      /LLM_USER_DAILY_CAP_USD/,
    );
  });
});
