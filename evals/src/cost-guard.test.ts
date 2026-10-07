import { describe, expect, it } from "vitest";
import { checkEstimate, createSpendGuard } from "./cost-guard";

const estimate = (usd: number | null) => ({
  calls: 16,
  tokensInPerCall: 4_000,
  tokensOutPerCall: 400,
  source: "test",
  usd,
});

describe("checkEstimate: el tope no tiene excepción", () => {
  it("estimado bajo o igual al tope: ok", () => {
    expect(checkEstimate(estimate(0.4), 0.5)).toEqual({ ok: true });
    expect(checkEstimate(estimate(0.5), 0.5)).toEqual({ ok: true });
  });

  it("estimado sobre el tope: no ok, y dice cómo seguir", () => {
    const r = checkEstimate(estimate(0.51), 0.5);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/supera --max-usd 0.5.*subí --max-usd/);
  });

  it("sin tarifa: no ok (no se puede garantizar el tope)", () => {
    const r = checkEstimate(estimate(null), 10);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/no hay tarifa/);
  });

  it("estimado en 0 con llamadas (tarifa 0 o mal cargada): no ok, como sin tarifa", () => {
    const r = checkEstimate(estimate(0), 0.5);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/en 0 o mal cargada/);
    // Sin llamadas planificadas, 0 es un estimado válido
    expect(checkEstimate({ usd: 0, calls: 0 }, 0.5)).toEqual({ ok: true });
  });

  it("sobre el tope aborta siempre: la función no tiene parámetro para anularlo (--yes)", () => {
    // El tipo de la firma es (estimate, maxUsd): typecheck impide pasar un tercer argumento
    expect(checkEstimate(estimate(5), 1).ok).toBe(false);
  });
});

describe("createSpendGuard", () => {
  it("concurrencia 1: lo gastado + una llamada más debe entrar en el tope", () => {
    const g = createSpendGuard(0.03, 0.01);
    let launched = 0;
    while (g.canStart()) {
      g.started();
      g.finished(0.01);
      launched++;
    }
    expect(launched).toBe(3);
    expect(g.spent()).toBeCloseTo(0.03, 9);
  });

  it("concurrencia 3: las llamadas en vuelo cuentan con su costo esperado", () => {
    const g = createSpendGuard(0.05, 0.01);
    let launched = 0;
    for (let i = 0; i < 10 && g.canStart(); i++) {
      g.started();
      launched++;
    }
    // Nada terminó: 5 en vuelo × 0.01 = tope, la sexta no entra
    expect(launched).toBe(5);
    expect(g.canStart()).toBe(false);
    // Una termina gratis: libera lugar para una más
    g.finished(0);
    expect(g.canStart()).toBe(true);
    g.started();
    expect(g.canStart()).toBe(false);
  });

  it("costo real null cuenta el esperado", () => {
    const g = createSpendGuard(1, 0.4);
    g.started();
    g.finished(null);
    expect(g.spent()).toBeCloseTo(0.4, 9);
    expect(g.canStart()).toBe(true);
    g.started();
    g.finished(null);
    expect(g.canStart()).toBe(false);
  });

  it("una llamada real más cara que lo esperado se refleja en lo gastado", () => {
    const g = createSpendGuard(0.05, 0.01);
    g.started();
    g.finished(0.045);
    expect(g.canStart()).toBe(false);
    expect(g.spent()).toBeCloseTo(0.045, 9);
  });
});
