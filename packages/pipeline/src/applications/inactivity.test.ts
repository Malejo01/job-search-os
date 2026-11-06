import { describe, expect, it } from "vitest";
import { APPLICATION_OUTCOMES } from "../feedback";
import { JOB_STATUSES } from "../status";
import {
  groupApplication,
  INACTIVE_DAYS,
  isInactiveApplication,
  isInactiveEvaluated,
  lastActivity,
  type InactivityInput,
} from "./inactivity";
import { FOLLOW_UP_SNOOZE_DAYS } from "./followup";

const DAY_MS = 24 * 60 * 60 * 1000;
const TODAY = new Date("2026-11-06T12:00:00Z");
const ago = (days: number) => new Date(TODAY.getTime() - days * DAY_MS);

const base: InactivityInput = {
  status: "aplicada",
  outcome: "sin_respuesta",
  appliedAt: ago(40),
  outcomeAt: null,
  followUpAt: null,
  touchedAt: ago(40),
};

describe("INACTIVE_DAYS", () => {
  it("son 30", () => expect(INACTIVE_DAYS).toBe(30));
});

describe("isInactiveApplication", () => {
  it("29 días no es inactiva y 30 sí", () => {
    expect(isInactiveApplication({ ...base, appliedAt: ago(29), touchedAt: ago(29) }, TODAY)).toBe(
      false,
    );
    expect(isInactiveApplication({ ...base, appliedAt: ago(30), touchedAt: ago(30) }, TODAY)).toBe(
      true,
    );
  });

  it("una postergación reciente la reactiva", () => {
    // postergada hace 2 días: followUpAt = hace 2 días + 7
    const followUpAt = new Date(ago(2).getTime() + FOLLOW_UP_SNOOZE_DAYS * DAY_MS);
    expect(isInactiveApplication({ ...base, followUpAt }, TODAY)).toBe(false);
  });

  it("un outcomeAt reciente la reactiva", () => {
    expect(isInactiveApplication({ ...base, outcomeAt: ago(3) }, TODAY)).toBe(false);
  });

  it("un jobs.updated_at reciente la reactiva", () => {
    expect(isInactiveApplication({ ...base, touchedAt: ago(1) }, TODAY)).toBe(false);
  });

  it("entrevista y oferta nunca son inactivas", () => {
    expect(isInactiveApplication({ ...base, status: "entrevista" }, TODAY)).toBe(false);
    expect(isInactiveApplication({ ...base, status: "oferta" }, TODAY)).toBe(false);
  });

  it("con resultado distinto de sin_respuesta no es inactiva", () => {
    expect(isInactiveApplication({ ...base, outcome: "rechazo_humano" }, TODAY)).toBe(false);
  });

  it("sin ninguna fecha no es inactiva", () => {
    expect(
      isInactiveApplication(
        { ...base, appliedAt: null, outcomeAt: null, followUpAt: null, touchedAt: null },
        TODAY,
      ),
    ).toBe(false);
  });
});

describe("lastActivity", () => {
  it("devuelve el máximo de las fechas", () => {
    expect(lastActivity({ ...base, outcomeAt: ago(5) })?.getTime()).toBe(ago(5).getTime());
  });
  it("null sin fechas", () => {
    expect(
      lastActivity({
        ...base,
        appliedAt: null,
        outcomeAt: null,
        followUpAt: null,
        touchedAt: null,
      }),
    ).toBeNull();
  });
});

describe("isInactiveEvaluated", () => {
  it("evaluada con 30 días o más sin tocar", () => {
    expect(isInactiveEvaluated({ status: "evaluada", touchedAt: ago(29) }, TODAY)).toBe(false);
    expect(isInactiveEvaluated({ status: "evaluada", touchedAt: ago(30) }, TODAY)).toBe(true);
  });
  it("otros estados o sin fecha, no", () => {
    expect(isInactiveEvaluated({ status: "aplicada", touchedAt: ago(90) }, TODAY)).toBe(false);
    expect(isInactiveEvaluated({ status: "evaluada", touchedAt: null }, TODAY)).toBe(false);
  });
});

describe("groupApplication", () => {
  const g = (o: Partial<InactivityInput> & { followUpDue?: boolean }) =>
    groupApplication({ ...base, followUpDue: false, ...o }, TODAY);

  it("seguimiento vencido y no inactiva -> seguimiento", () => {
    expect(g({ appliedAt: ago(10), touchedAt: ago(10), followUpDue: true })).toBe("seguimiento");
  });
  it("entrevista con seguimiento vencido -> seguimiento", () => {
    expect(g({ status: "entrevista", outcome: "entrevista", followUpDue: true })).toBe(
      "seguimiento",
    );
  });
  it("vencida e inactiva -> inactivas (gana la inactividad)", () => {
    expect(g({ followUpDue: true })).toBe("inactivas");
  });
  it("entrevista y oferta sin vencer -> activas", () => {
    expect(g({ status: "entrevista", outcome: "entrevista" })).toBe("activas");
    expect(g({ status: "oferta", outcome: "oferta" })).toBe("activas");
  });
  it("aplicada reciente sin respuesta -> esperando", () => {
    expect(g({ appliedAt: ago(3), touchedAt: ago(3) })).toBe("esperando");
  });
  it("cerrada con cerrada_antes -> cerradas", () => {
    expect(g({ status: "cerrada", outcome: "cerrada_antes" })).toBe("cerradas");
  });
  it("aplicada con resultado cambiado a mano", () => {
    expect(g({ outcome: "entrevista" })).toBe("activas");
    expect(g({ outcome: "oferta" })).toBe("activas");
    expect(g({ outcome: "rechazo_humano" })).toBe("cerradas");
  });
  it("rechazadas -> cerradas", () => {
    expect(g({ status: "rechazada", outcome: "rechazo_humano" })).toBe("cerradas");
    expect(g({ status: "rechazo_automatico", outcome: "rechazo_automatico_otro" })).toBe(
      "cerradas",
    );
  });
  it("todo par estado/resultado devuelve un grupo", () => {
    const valid = ["seguimiento", "activas", "esperando", "inactivas", "cerradas"];
    for (const status of JOB_STATUSES) {
      for (const outcome of APPLICATION_OUTCOMES) {
        for (const followUpDue of [true, false]) {
          expect(valid).toContain(g({ status, outcome, followUpDue }));
        }
      }
    }
  });
});
