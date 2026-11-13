import { describe, expect, it } from "vitest";
import {
  BUDGET_ALERT_THRESHOLDS,
  budgetAlertDay,
  budgetAlertIdempotencyKey,
  buildBudgetAlertEmail,
  crossedThresholds,
  parseAlertRecipients,
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

  it("la clave de Resend es fecha:umbral:destinatario", () => {
    expect(budgetAlertIdempotencyKey("2026-11-12", 85, 0)).toBe("budget-alert:2026-11-12:85:0");
    expect(budgetAlertIdempotencyKey("2026-11-12", 85, 1)).not.toBe(
      budgetAlertIdempotencyKey("2026-11-12", 85, 0),
    );
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
