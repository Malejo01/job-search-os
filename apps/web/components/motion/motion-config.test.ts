import { describe, expect, it } from "vitest";
import { barMotion, disclosureMotion } from "./motion-config";

describe("microinteracciones (R23-06)", () => {
  it("la primera carga (detalle cerrado) no anima: queda en el estado final", () => {
    expect(disclosureMotion({ reduce: false, openCount: 0 }).initial).toBe(false);
    expect(barMotion({ reduce: false, openCount: 0, percent: 70, index: 0 }).initial).toBe(false);
  });

  it("con movimiento reducido nunca anima, aunque se abra", () => {
    expect(disclosureMotion({ reduce: true, openCount: 2 }).initial).toBe(false);
    const bar = barMotion({ reduce: true, openCount: 2, percent: 70, index: 3 });
    expect(bar.initial).toBe(false);
    expect(bar.transition.duration).toBe(0);
  });

  it("al abrir, el panel crece desde altura 0 y las barras desde ancho 0", () => {
    expect(disclosureMotion({ reduce: false, openCount: 1 }).initial).toEqual({
      height: 0,
      opacity: 0,
    });
    const bar = barMotion({ reduce: false, openCount: 1, percent: 70, index: 0 });
    expect(bar.initial).toEqual({ width: "0%" });
    expect(bar.animate).toEqual({ width: "70%" });
  });

  it("las barras entran escalonadas pero con tope", () => {
    const d = (i: number) => barMotion({ reduce: false, openCount: 1, percent: 50, index: i });
    expect(d(1).transition.delay).toBeGreaterThan(d(0).transition.delay ?? 0);
    expect(d(50).transition.delay).toBeLessThanOrEqual(0.4);
  });
});
