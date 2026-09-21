import { describe, expect, it } from "vitest";
import {
  applicationEffect,
  correctionTargets,
  correctStatus,
  InvalidCorrectionError,
} from "./status-correction";

const evaluated = { hasEvaluation: true, hasJd: true };

describe("corrección manual de estado (JS-028)", () => {
  it("un rechazo automático marcado por error vuelve a aplicada (o a cualquier estado posterior a evaluar)", () => {
    expect(correctStatus("rechazo_automatico", "aplicada", evaluated)).toBe("aplicada");
    expect(correctionTargets("rechazo_automatico", evaluated)).toEqual([
      "evaluada",
      "aplicada",
      "entrevista",
      "oferta",
      "rechazada",
      "descartada",
      "cerrada",
    ]);
  });

  it("aplicada por error vuelve a evaluada; rechazada/entrevista/cerrada se corrigen igual", () => {
    expect(correctStatus("aplicada", "evaluada", evaluated)).toBe("evaluada");
    expect(correctStatus("rechazada", "entrevista", evaluated)).toBe("entrevista");
    expect(correctStatus("entrevista", "rechazada", evaluated)).toBe("rechazada");
    expect(correctStatus("cerrada", "aplicada", evaluated)).toBe("aplicada");
  });

  it("no se corrige hacia el mismo estado", () => {
    expect(correctionTargets("aplicada", evaluated)).not.toContain("aplicada");
    expect(() => correctStatus("aplicada", "aplicada", evaluated)).toThrow(InvalidCorrectionError);
  });

  it("los estados del pipeline no se corrigen a mano: ni desde ni hacia", () => {
    for (const from of [
      "nueva",
      "prefiltrada",
      "pendiente_jd",
      "descartada_prefiltro",
      "evaluada",
    ] as const)
      expect(correctionTargets(from, evaluated)).toEqual([]);
    for (const to of ["nueva", "prefiltrada", "descartada_prefiltro"] as const)
      expect(() => correctStatus("aplicada", to, evaluated)).toThrow(InvalidCorrectionError);
  });

  it("sin evaluación no hay estados posteriores: una cerrada desde la cola de JD solo vuelve a pendiente_jd", () => {
    const sinEval = { hasEvaluation: false, hasJd: false };
    expect(correctionTargets("cerrada", sinEval)).toEqual(["pendiente_jd"]);
    expect(correctStatus("cerrada", "pendiente_jd", sinEval)).toBe("pendiente_jd");
    expect(() => correctStatus("cerrada", "aplicada", sinEval)).toThrow(InvalidCorrectionError);
    // Con JD pero sin evaluación (quedó en cola al cerrarla): no hay a dónde volver a mano
    expect(correctionTargets("cerrada", { hasEvaluation: false, hasJd: true })).toEqual([]);
  });

  it("la postulación acompaña al estado corregido", () => {
    expect(applicationEffect("aplicada")).toEqual({ kind: "ensure", outcome: null });
    expect(applicationEffect("entrevista")).toEqual({ kind: "ensure", outcome: "entrevista" });
    expect(applicationEffect("oferta")).toEqual({ kind: "ensure", outcome: "oferta" });
    expect(applicationEffect("rechazada")).toEqual({ kind: "ensure", outcome: "rechazo_humano" });
    expect(applicationEffect("rechazo_automatico")).toEqual({
      kind: "ensure",
      outcome: "rechazo_automatico_otro",
    });
    // Si en realidad no se postuló, la postulación registrada era un error: se borra
    expect(applicationEffect("evaluada")).toEqual({ kind: "remove" });
    expect(applicationEffect("descartada")).toEqual({ kind: "remove" });
    expect(applicationEffect("pendiente_jd")).toEqual({ kind: "remove" });
    // Cerrada: si había postulación, quedó cerrada antes de responder; si no, nada
    expect(applicationEffect("cerrada")).toEqual({ kind: "if_exists", outcome: "cerrada_antes" });
  });
});
