import { describe, expect, it } from "vitest";
import {
  availableEvents,
  canTransition,
  InvalidTransitionError,
  JOB_STATUSES,
  transition,
  REQUEUE_STATUSES,
  requeueAllowed,
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

describe("re-evaluar no mueve el estado (JS-057)", () => {
  // Re-evaluar es leer de nuevo, no retroceder en el embudo: una oferta postulada, en entrevista
  // o con oferta sigue ahí aunque el prompt o el perfil cambien.
  it.each(["aplicada", "entrevista", "oferta"] as const)(
    "%s + evaluated → queda igual",
    (status) => {
      expect(canTransition(status, "evaluated")).toBe(true);
      expect(transition(status, "evaluated")).toBe(status);
    },
  );

  it.each([
    "descartada",
    "rechazada",
    "rechazo_automatico",
    "cerrada",
    "descartada_prefiltro",
  ] as const)("%s no se re-evalúa: el embudo ya terminó", (status) => {
    expect(canTransition(status, "evaluated")).toBe(false);
    expect(() => transition(status, "evaluated")).toThrow(InvalidTransitionError);
  });

  it("evaluated no es un evento que la persona dispare: no agrega botones en la UI", () => {
    // La UI filtra availableEvents por MANUAL_EVENTS; evaluated lo dispara solo el worker
    expect(availableEvents("aplicada")).toContain("evaluated");
    expect(REQUEUE_STATUSES.explicit).toContain("aplicada");
  });
});

describe("requeueAllowed: qué se puede re-encolar (JS-057)", () => {
  it("el requeue masivo (--model) sigue restringido a evaluada", () => {
    expect(requeueAllowed("evaluada", "bulk")).toBe(true);
    for (const status of ["aplicada", "entrevista", "oferta", "descartada", "cerrada"] as const) {
      expect(requeueAllowed(status, "bulk"), status).toBe(false);
    }
  });

  it("con --job explícito también aplicada, entrevista y oferta", () => {
    for (const status of ["evaluada", "aplicada", "entrevista", "oferta"] as const) {
      expect(requeueAllowed(status, "explicit"), status).toBe(true);
    }
  });

  it("con --job explícito tampoco lo terminal ni lo que todavía no se evaluó", () => {
    for (const status of [
      "descartada",
      "rechazada",
      "rechazo_automatico",
      "cerrada",
      "descartada_prefiltro",
      "nueva",
      "prefiltrada",
      "pendiente_jd",
    ] as const) {
      expect(requeueAllowed(status, "explicit"), status).toBe(false);
    }
  });

  it("todo lo que se puede re-encolar, el worker lo puede evaluar sin cambiarle el estado", () => {
    for (const status of REQUEUE_STATUSES.explicit) {
      expect(canTransition(status, "evaluated"), status).toBe(true);
      expect(transition(status, "evaluated"), status).toBe(status);
    }
  });
});
