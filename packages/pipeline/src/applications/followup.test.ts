import { describe, expect, it } from "vitest";
import { followUpDue } from "./followup";

const today = new Date("2026-10-21T12:00:00Z");
const daysAgo = (n: number) => new Date(today.getTime() - n * 86_400_000);

describe("followUpDue", () => {
  it("aplicada: vence a los 7 días", () => {
    expect(
      followUpDue(
        { status: "aplicada", appliedAt: daysAgo(7), outcomeAt: null, followUpAt: null },
        today,
      ).due,
    ).toBe(true);
    expect(
      followUpDue(
        { status: "aplicada", appliedAt: daysAgo(6), outcomeAt: null, followUpAt: null },
        today,
      ),
    ).toEqual({ due: false, dueSince: null });
  });

  it("devuelve desde cuándo vence", () => {
    const r = followUpDue(
      { status: "aplicada", appliedAt: daysAgo(10), outcomeAt: null, followUpAt: null },
      today,
    );
    expect(r.dueSince).toEqual(daysAgo(3));
  });

  it("entrevista: usa outcomeAt y vence a los 5 días", () => {
    const base = { status: "entrevista", appliedAt: daysAgo(30), followUpAt: null };
    expect(followUpDue({ ...base, outcomeAt: daysAgo(6) }, today).due).toBe(true);
    expect(followUpDue({ ...base, outcomeAt: daysAgo(4) }, today).due).toBe(false);
  });

  it("entrevista sin outcomeAt cae a appliedAt", () => {
    expect(
      followUpDue(
        { status: "entrevista", appliedAt: daysAgo(6), outcomeAt: null, followUpAt: null },
        today,
      ).due,
    ).toBe(true);
  });

  it("la postergación manda si es posterior", () => {
    const future = new Date(today.getTime() + 3 * 86_400_000);
    expect(
      followUpDue(
        { status: "aplicada", appliedAt: daysAgo(20), outcomeAt: null, followUpAt: future },
        today,
      ).due,
    ).toBe(false);
    expect(
      followUpDue(
        { status: "aplicada", appliedAt: daysAgo(20), outcomeAt: null, followUpAt: daysAgo(1) },
        today,
      ).due,
    ).toBe(true);
  });

  it("una postergación hecha antes de la entrevista no oculta el aviso de la entrevista", () => {
    // Entrevista hace 6 días; la postergación se hizo medio día antes, estando «aplicada»: vence en
    // medio día, pero el aviso de la entrevista (5 días) ya corresponde
    const outcomeAt = daysAgo(6);
    const snoozedBefore = new Date(daysAgo(6.5).getTime() + 7 * 86_400_000);
    expect(
      followUpDue(
        { status: "entrevista", appliedAt: daysAgo(20), outcomeAt, followUpAt: snoozedBefore },
        today,
      ).due,
    ).toBe(true);
    // Pospuso después de la entrevista (hace 1 día): manda la postergación
    const snoozedAfter = new Date(daysAgo(1).getTime() + 7 * 86_400_000);
    expect(
      followUpDue(
        { status: "entrevista", appliedAt: daysAgo(20), outcomeAt, followUpAt: snoozedAfter },
        today,
      ).due,
    ).toBe(false);
  });

  it("otros estados o sin fecha no vencen", () => {
    for (const status of ["rechazada", "oferta", "cerrada", "evaluada"]) {
      expect(
        followUpDue({ status, appliedAt: daysAgo(30), outcomeAt: null, followUpAt: null }, today)
          .due,
      ).toBe(false);
    }
    expect(
      followUpDue({ status: "aplicada", appliedAt: null, outcomeAt: null, followUpAt: null }, today)
        .due,
    ).toBe(false);
  });
});
