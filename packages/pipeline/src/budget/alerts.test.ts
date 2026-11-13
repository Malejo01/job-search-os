import { describe, expect, it } from "vitest";
import {
  BUDGET_ALERT_RECHECK_MS,
  BUDGET_ALERT_THRESHOLDS,
  budgetAlertDay,
  budgetAlertIdempotencyKey,
  buildBudgetAlertEmail,
  crossedThresholds,
  nextBudgetAlertMemo,
  parseAlertRecipients,
  planBudgetAlerts,
  shouldCheckBudgetAlerts,
} from "./alerts";

describe("crossedThresholds (R7-1)", () => {
  it("los umbrales son 70, 85 y 95 %", () => {
    expect(BUDGET_ALERT_THRESHOLDS).toEqual([70, 85, 95]);
  });

  it("no avisa por debajo del 70 %", () => {
    expect(crossedThresholds(1.39, 2, [])).toEqual([]);
    expect(crossedThresholds(0, 2, [])).toEqual([]);
  });

  it("avisa justo en el 70 % (inclusive) y no en el siguiente", () => {
    expect(crossedThresholds(1.4, 2, [])).toEqual([70]);
    expect(crossedThresholds(1.69, 2, [])).toEqual([70]);
  });

  it("devuelve todos los umbrales pasados, de menor a mayor", () => {
    expect(crossedThresholds(1.7, 2, [])).toEqual([70, 85]);
    expect(crossedThresholds(1.9, 2, [])).toEqual([70, 85, 95]);
    expect(crossedThresholds(5, 2, [])).toEqual([70, 85, 95]);
  });

  it("no repite los que ya se avisaron", () => {
    expect(crossedThresholds(1.7, 2, [70])).toEqual([85]);
    expect(crossedThresholds(1.7, 2, [70, 85])).toEqual([]);
    expect(crossedThresholds(1.95, 2, [70, 85, 95])).toEqual([]);
  });

  it("si saltó de golpe, los que no se avisaron siguen pendientes aunque haya uno posterior avisado", () => {
    expect(crossedThresholds(1.95, 2, [95])).toEqual([70, 85]);
  });

  it("sin tope (0 o negativo) o con valores inválidos no avisa", () => {
    expect(crossedThresholds(10, 0, [])).toEqual([]);
    expect(crossedThresholds(10, -1, [])).toEqual([]);
    expect(crossedThresholds(Number.NaN, 2, [])).toEqual([]);
    expect(crossedThresholds(1.9, Number.POSITIVE_INFINITY, [])).toEqual([]);
    expect(crossedThresholds(-1, 2, [])).toEqual([]);
  });

  it("tolera el redondeo de punto flotante en el borde", () => {
    // 0.7 * 3 = 2.0999999999999996 en flotante: el 70 % de 3 USD tiene que contar
    expect(crossedThresholds(2.1, 3, [])).toEqual([70]);
  });
});

describe("clave del día y de idempotencia", () => {
  it("el día es la fecha UTC", () => {
    expect(budgetAlertDay(new Date("2026-11-12T23:59:59.000Z"))).toBe("2026-11-12");
    expect(budgetAlertDay(new Date("2026-11-13T00:00:00.000Z"))).toBe("2026-11-13");
  });

  it("la clave de Resend es fecha:umbral:id del destinatario (no su posición en la lista)", () => {
    expect(budgetAlertIdempotencyKey("2026-11-12", 85, "aaaa1111")).toBe(
      "budget-alert:2026-11-12:85:aaaa1111",
    );
    expect(budgetAlertIdempotencyKey("2026-11-12", 85, "bbbb2222")).not.toBe(
      budgetAlertIdempotencyKey("2026-11-12", 85, "aaaa1111"),
    );
  });
});

describe("planBudgetAlerts (R8-5): qué umbrales le faltan a cada destinatario", () => {
  const base = { capUsd: 2, recipientIds: ["a", "b"] };

  it("sin marcas, todos reciben todo lo cruzado, con el más alto como asunto", () => {
    const plan = planBudgetAlerts({ ...base, spentUsd: 1.75, marks: [] });
    expect(plan).toEqual([
      { recipientId: "a", thresholds: [70, 85], top: 85 },
      { recipientId: "b", thresholds: [70, 85], top: 85 },
    ]);
  });

  it("reintenta solo al que falló: el que ya recibió el umbral no vuelve a la lista", () => {
    const plan = planBudgetAlerts({
      ...base,
      spentUsd: 1.5,
      marks: [{ recipientId: "a", threshold: 70 }],
    });
    expect(plan).toEqual([{ recipientId: "b", thresholds: [70], top: 70 }]);
  });

  it("a cada uno le faltan sus propios umbrales", () => {
    const plan = planBudgetAlerts({
      ...base,
      spentUsd: 1.75,
      marks: [
        { recipientId: "a", threshold: 70 },
        { recipientId: "a", threshold: 85 },
        { recipientId: "b", threshold: 70 },
      ],
    });
    expect(plan).toEqual([{ recipientId: "b", thresholds: [85], top: 85 }]);
  });

  it("una marca vieja sin destinatario (R7-1) cuenta como enviada a todos", () => {
    expect(
      planBudgetAlerts({ ...base, spentUsd: 1.5, marks: [{ recipientId: null, threshold: 70 }] }),
    ).toEqual([]);
  });

  it("una marca de un destinatario que ya no está no afecta a los demás", () => {
    const plan = planBudgetAlerts({
      ...base,
      spentUsd: 1.5,
      marks: [{ recipientId: "viejo", threshold: 70 }],
    });
    expect(plan.map((p) => p.recipientId)).toEqual(["a", "b"]);
  });

  it("sin umbral cruzado, sin tope o sin destinatarios no hay plan", () => {
    expect(planBudgetAlerts({ ...base, spentUsd: 1, marks: [] })).toEqual([]);
    expect(planBudgetAlerts({ ...base, capUsd: 0, spentUsd: 9, marks: [] })).toEqual([]);
    expect(planBudgetAlerts({ ...base, recipientIds: [], spentUsd: 9, marks: [] })).toEqual([]);
  });
});

describe("memo por día (R8-5): evaluar sin consultar la base", () => {
  const T0 = new Date("2026-11-12T15:00:00.000Z");
  const at = (ms: number) => new Date(T0.getTime() + ms);

  it("sin memo, o con memo de otro día, se consulta", () => {
    expect(shouldCheckBudgetAlerts(null, T0)).toBe(true);
    const old = { day: "2026-11-11", doneTop: 95, checkedAtMs: T0.getTime() };
    expect(shouldCheckBudgetAlerts(old, T0)).toBe(true);
  });

  it("con el umbral más alto ya avisado a todos no se consulta más ese día", () => {
    const memo = nextBudgetAlertMemo("2026-11-12", T0, { crossedTop: 95, complete: true });
    expect(memo.doneTop).toBe(95);
    expect(shouldCheckBudgetAlerts(memo, at(60 * 60_000))).toBe(false);
  });

  it("con umbrales todavía por delante se consulta como mucho una vez cada 5 minutos", () => {
    const memo = nextBudgetAlertMemo("2026-11-12", T0, { crossedTop: 70, complete: true });
    expect(shouldCheckBudgetAlerts(memo, at(60_000))).toBe(false);
    expect(shouldCheckBudgetAlerts(memo, at(BUDGET_ALERT_RECHECK_MS))).toBe(true);
  });

  it("si algún envío falló, doneTop no se da por cumplido y se vuelve a mirar", () => {
    const memo = nextBudgetAlertMemo("2026-11-12", T0, { crossedTop: 95, complete: false });
    expect(memo.doneTop).toBe(0);
    expect(shouldCheckBudgetAlerts(memo, at(BUDGET_ALERT_RECHECK_MS))).toBe(true);
  });

  it("al cambiar el día (UTC) vuelve a consultar aunque ayer estuviera completo", () => {
    const memo = nextBudgetAlertMemo("2026-11-12", T0, { crossedTop: 95, complete: true });
    expect(shouldCheckBudgetAlerts(memo, new Date("2026-11-13T00:00:01.000Z"))).toBe(true);
  });
});

describe("parseAlertRecipients", () => {
  it("separa por coma, recorta, saca vacíos y repetidos sin distinguir mayúsculas", () => {
    expect(parseAlertRecipients(" a@ejemplo.test, B@ejemplo.test ,,a@EJEMPLO.test")).toEqual([
      "a@ejemplo.test",
      "b@ejemplo.test",
    ]);
    expect(parseAlertRecipients(undefined)).toEqual([]);
    expect(parseAlertRecipients("")).toEqual([]);
  });
});

describe("buildBudgetAlertEmail", () => {
  const email = buildBudgetAlertEmail({
    threshold: 85,
    spentUsd: 1.7,
    capUsd: 2,
    adminUrl: "https://app.example.test/settings/salud",
  });

  it("es corto, en español, con montos agregados y el link", () => {
    expect(email.subject).toContain("85");
    expect(email.text).toContain("1,70");
    expect(email.text).toContain("2,00");
    expect(email.text).toContain("https://app.example.test/settings/salud");
    expect(email.text.split("\n").length).toBeLessThan(12);
  });

  it("al 95 % avisa que el tope está cerca de frenar la evaluación", () => {
    const e = buildBudgetAlertEmail({
      threshold: 95,
      spentUsd: 1.9,
      capUsd: 2,
      adminUrl: "https://app.example.test/settings/salud",
    });
    expect(e.text.toLowerCase()).toContain("frena");
  });
});
