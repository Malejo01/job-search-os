import { describe, expect, it } from "vitest";
import { formatDecimal, formatScore, formatScoreNumber } from "../lib/labels";

describe("números con coma decimal (R24-05)", () => {
  it("formatDecimal usa coma y los decimales pedidos", () => {
    expect(formatDecimal(1.5, 1)).toBe("1,5");
    expect(formatDecimal(2, 1)).toBe("2,0");
    expect(formatDecimal(-0.25, 2)).toBe("-0,25");
    expect(formatDecimal(0.04, 1)).toBe("0,0");
  });

  it("formatDecimal con signo marca el positivo", () => {
    expect(formatDecimal(0.5, 1, { signed: true })).toBe("+0,5");
    expect(formatDecimal(-0.5, 1, { signed: true })).toBe("-0,5");
    expect(formatDecimal(0, 1, { signed: true })).toBe("+0,0");
  });

  it("el puntaje sigue con coma", () => {
    expect(formatScoreNumber(7.5)).toBe("7,5");
    expect(formatScore(8)).toBe("8/10");
  });
});
