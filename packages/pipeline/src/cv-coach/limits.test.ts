import { describe, expect, it } from "vitest";
import {
  CV_COACH_MAX_FLOW_COST_USD,
  CV_COACH_MAX_TURNS,
  CV_COACH_RESERVE_USD,
  cvCoachCapNotice,
  cvCoachCapReason,
  type CvCoachCapInput,
} from "./limits";

const ok: CvCoachCapInput = {
  step: "turn",
  turns: 0,
  reviews: 0,
  flowCostUsd: 0.05,
  written: false,
};

describe("topes del coach (ADR-038 §9, D5)", () => {
  it("valores de D5: USD 0,30 y 15 turnos", () => {
    expect(CV_COACH_MAX_FLOW_COST_USD).toBe(0.3);
    expect(CV_COACH_MAX_TURNS).toBe(15);
  });

  it("deja pasar un turno con margen", () => {
    expect(cvCoachCapReason(ok)).toBeNull();
  });

  it("corta en el turno 15", () => {
    expect(cvCoachCapReason({ ...ok, turns: 14 })).toBeNull();
    expect(cvCoachCapReason({ ...ok, turns: 15 })).toBe("turnos");
  });

  it("corta el segundo reintento del diagnóstico", () => {
    expect(cvCoachCapReason({ ...ok, step: "review", reviews: 1 })).toBeNull();
    expect(cvCoachCapReason({ ...ok, step: "review", reviews: 2 })).toBe("diagnosticos");
  });

  it("un turno siempre deja reservada la redacción del CV", () => {
    // gastado + turno + redacción = 0,30 justo: pasa
    const edge =
      CV_COACH_MAX_FLOW_COST_USD - CV_COACH_RESERVE_USD.turn - CV_COACH_RESERVE_USD.write;
    expect(cvCoachCapReason({ ...ok, flowCostUsd: edge - 1e-9 })).toBeNull();
    // un centavo más y el turno se rechaza, aunque el turno solo entraría
    expect(cvCoachCapReason({ ...ok, flowCostUsd: edge + 0.01 })).toBe("charla");
  });

  it("la redacción solo necesita su propia reserva", () => {
    const spent = CV_COACH_MAX_FLOW_COST_USD - CV_COACH_RESERVE_USD.write;
    expect(cvCoachCapReason({ ...ok, step: "write", flowCostUsd: spent })).toBeNull();
    expect(cvCoachCapReason({ ...ok, step: "write", flowCostUsd: spent + 0.001 })).toBe("charla");
  });

  it("si el CV ya se redactó, no se reserva de nuevo", () => {
    const spent = CV_COACH_MAX_FLOW_COST_USD - CV_COACH_RESERVE_USD.turn;
    expect(cvCoachCapReason({ ...ok, flowCostUsd: spent, written: false })).toBe("charla");
    expect(cvCoachCapReason({ ...ok, flowCostUsd: spent, written: true })).toBeNull();
  });

  it("falla cerrado con números inválidos", () => {
    expect(cvCoachCapReason({ ...ok, turns: Number.NaN })).toBe("turnos");
    expect(cvCoachCapReason({ ...ok, flowCostUsd: Number.NaN })).toBe("charla");
    expect(cvCoachCapReason({ ...ok, flowCostUsd: -1 })).toBe("charla");
    expect(cvCoachCapReason({ ...ok, step: "review", reviews: Number.NaN })).toBe("diagnosticos");
  });

  it("los mensajes son fijos y siempre ofrecen ir al cierre", () => {
    for (const cap of ["turnos", "diagnosticos", "charla"] as const) {
      const n = cvCoachCapNotice(cap);
      expect(n.message).not.toMatch(/\d/);
      expect(n.links.map((l) => l.href)).toContain("/cv/coach/listo");
    }
  });
});
