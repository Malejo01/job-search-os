import { describe, expect, it } from "vitest";
import {
  availableEvents,
  canTransition,
  InvalidTransitionError,
  JOB_STATUSES,
  transition,
} from "./status";

describe("transition (máquina de estados de jobs.status)", () => {
  it("camino feliz: nueva → prefiltrada → pendiente_jd → evaluada → aplicada → entrevista → oferta", () => {
    let s = transition("nueva", "prefilter_pass");
    expect(s).toBe("prefiltrada");
    s = transition(s, "needs_jd");
    expect(s).toBe("pendiente_jd");
    s = transition(s, "evaluated");
    expect(s).toBe("evaluada");
    s = transition(s, "apply");
    expect(s).toBe("aplicada");
    s = transition(s, "interview");
    expect(s).toBe("entrevista");
    expect(transition(s, "offer")).toBe("oferta");
  });

  it("descartes: prefiltro, evaluación, rechazo automático y humano", () => {
    expect(transition("nueva", "prefilter_discard")).toBe("descartada_prefiltro");
    expect(transition("evaluada", "discard")).toBe("descartada");
    expect(transition("aplicada", "auto_reject")).toBe("rechazo_automatico");
    expect(transition("aplicada", "reject")).toBe("rechazada");
    expect(transition("entrevista", "reject")).toBe("rechazada");
  });

  it("prefiltrada con JD → evaluada directo (sin pasar por pendiente_jd)", () => {
    expect(transition("prefiltrada", "evaluated")).toBe("evaluada");
  });

  it("re-evaluar una evaluada (nuevo prompt o JD pegada) es válido", () => {
    expect(transition("evaluada", "evaluated")).toBe("evaluada");
  });

  it("cerrada vale desde cualquier estado", () => {
    for (const s of JOB_STATUSES) expect(transition(s, "close")).toBe("cerrada");
  });

  it("transición inválida lanza InvalidTransitionError", () => {
    expect(() => transition("nueva", "apply")).toThrow(InvalidTransitionError);
    expect(() => transition("descartada", "apply")).toThrow(/transición inválida/);
    expect(() => transition("cerrada", "evaluated")).toThrow(InvalidTransitionError);
    expect(() => transition("aplicada", "prefilter_pass")).toThrow();
    expect(canTransition("nueva", "apply")).toBe(false);
    expect(canTransition("evaluada", "apply")).toBe(true);
  });

  it("availableEvents lista lo que la UI puede ofrecer", () => {
    expect(availableEvents("evaluada")).toEqual(["apply", "discard", "evaluated", "close"]);
    expect(availableEvents("cerrada")).toEqual([]);
    expect(availableEvents("aplicada")).toContain("auto_reject");
  });
});
