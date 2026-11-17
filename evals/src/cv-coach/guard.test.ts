import { describe, expect, it } from "vitest";
import {
  CV_COACH_EVAL_DEFAULT_MAX_USD,
  CV_COACH_STEP_MAX_USD,
  checkCoachEstimate,
  createCoachBudget,
  estimateCoachRun,
  tandaBudget,
} from "./guard";

describe("tope de la tanda (USD 2,50 en llm_calls con label r12)", () => {
  it("lo que queda de la tanda achica el tope de la corrida", () => {
    expect(tandaBudget(0.6, 0)).toEqual({ ok: true, maxUsd: 0.6 });
    const near = tandaBudget(0.6, 2.2);
    expect(near.ok && near.maxUsd).toBeCloseTo(0.3);
  });

  it("con la tanda gastada, o sin poder leerla, no se corre", () => {
    expect(tandaBudget(0.6, 2.5).ok).toBe(false);
    expect(tandaBudget(0.6, 3).ok).toBe(false);
    expect(tandaBudget(0.6, Number.NaN).ok).toBe(false);
    expect(tandaBudget(0, 0).ok).toBe(false);
  });
});

describe("estimado previo", () => {
  it("la charla completa de las 11 públicas no entra en USD 0,60: aborta antes de llamar", () => {
    const e = estimateCoachRun(11, "charla");
    expect(e.usd).toBeGreaterThan(CV_COACH_EVAL_DEFAULT_MAX_USD);
    expect(checkCoachEstimate(e, CV_COACH_EVAL_DEFAULT_MAX_USD).ok).toBe(false);
  });

  it("el diagnóstico de las 12 (11 + la privada) sí entra; la charla de 4 también", () => {
    expect(checkCoachEstimate(estimateCoachRun(12, "diagnostico"), 0.6).ok).toBe(true);
    expect(checkCoachEstimate(estimateCoachRun(4, "charla"), 0.6).ok).toBe(true);
  });
});

describe("presupuesto en vuelo", () => {
  it("frena antes de la llamada que podría pasar el tope, contando el máximo del paso", () => {
    const b = createCoachBudget(0.1);
    expect(b.canStart("review")).toBe(true);
    b.finished("review", 0.02);
    expect(b.canStart("turn")).toBe(true);
    b.finished("turn", 0.05);
    // 0,07 gastado + 0,04 del turno > 0,10
    expect(b.canStart("turn")).toBe(false);
    expect(b.cut()).toBe(true);
  });

  it("un turno se paga solo si además queda la reserva de la redacción", () => {
    const b = createCoachBudget(CV_COACH_STEP_MAX_USD.turn + CV_COACH_STEP_MAX_USD.write - 0.001);
    expect(b.canStart("turn")).toBe(true);
    expect(b.canStart("turn", { keepWrite: true })).toBe(false);
    expect(b.canStart("write")).toBe(true);
  });

  it("una llamada sin costo (sin tarifa o fallida) cuenta el máximo del paso", () => {
    const b = createCoachBudget(1);
    b.finished("write", null);
    expect(b.spent()).toBeCloseTo(CV_COACH_STEP_MAX_USD.write);
  });
});
