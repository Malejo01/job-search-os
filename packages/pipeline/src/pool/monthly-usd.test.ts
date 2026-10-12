import { describe, expect, it } from "vitest";
import { monthlyUsd } from "./monthly-usd";

describe("monthlyUsd", () => {
  it("mensual queda tal cual", () => {
    expect(monthlyUsd(4000, "mensual")).toBe(4000);
  });

  it("anual se divide por 12 y se redondea", () => {
    expect(monthlyUsd(120000, "anual")).toBe(10000);
    expect(monthlyUsd(100000, "anual")).toBe(8333);
  });

  it("por hora se multiplica por 160", () => {
    expect(monthlyUsd(25, "hora")).toBe(4000);
    expect(monthlyUsd(12.5, "hora")).toBe(2000);
  });

  it("sin monto o sin período no se supone mensual", () => {
    expect(monthlyUsd(null, "mensual")).toBeNull();
    expect(monthlyUsd(4000, null)).toBeNull();
    expect(monthlyUsd(4000, undefined)).toBeNull();
  });

  it("período desconocido da null", () => {
    expect(monthlyUsd(4000, "semanal" as never)).toBeNull();
    expect(monthlyUsd(4000, "" as never)).toBeNull();
  });

  it("monto no finito da null", () => {
    expect(monthlyUsd(Number.NaN, "mensual")).toBeNull();
    expect(monthlyUsd(Number.POSITIVE_INFINITY, "anual")).toBeNull();
  });
});
