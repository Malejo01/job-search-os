import { describe, expect, it } from "vitest";
// apps/web no tiene vitest: el test de su lógica pura vive acá (módulo sin dependencias)
import {
  FEEDBACK_DAILY_LIMIT,
  FEEDBACK_MESSAGE_MAX,
  FEEDBACK_PATH_MAX,
  isOverDailyLimit,
  isValidFeedbackPath,
  validateFeedback,
} from "../../../apps/web/lib/beta-feedback-core";

describe("isValidFeedbackPath", () => {
  it("acepta pathnames simples", () => {
    for (const p of ["/", "/hoy", "/jobs/abc-123", "/settings/metricas"]) {
      expect(isValidFeedbackPath(p), p).toBe(true);
    }
  });

  it("rechaza query, fragmento, .., barra doble, relativos y control", () => {
    for (const p of [
      "",
      "hoy",
      "/jobs?id=1",
      "/jobs#x",
      "/a/../b",
      "//otro.test",
      "/a\\b",
      "/a\nb",
      "https://ejemplo.test/hoy",
    ]) {
      expect(isValidFeedbackPath(p), p).toBe(false);
    }
  });

  it("respeta el largo máximo", () => {
    expect(isValidFeedbackPath("/" + "a".repeat(FEEDBACK_PATH_MAX - 1))).toBe(true);
    expect(isValidFeedbackPath("/" + "a".repeat(FEEDBACK_PATH_MAX))).toBe(false);
  });

  it("rechaza lo que no es texto", () => {
    expect(isValidFeedbackPath(null)).toBe(false);
    expect(isValidFeedbackPath(42)).toBe(false);
  });
});

describe("validateFeedback", () => {
  const ok = { category: "idea", message: "Una idea", path: "/hoy" };

  it("acepta y normaliza el mensaje", () => {
    expect(validateFeedback({ ...ok, message: "  hola\r\nchau  " })).toEqual({
      ok: true,
      value: { category: "idea", message: "hola\nchau", path: "/hoy" },
    });
  });

  it("devuelve el primer campo inválido, sin contenido", () => {
    expect(validateFeedback({ ...ok, category: "otra" })).toEqual({ ok: false, field: "category" });
    expect(validateFeedback({ ...ok, message: "   " })).toEqual({ ok: false, field: "message" });
    expect(validateFeedback({ ...ok, message: 5 })).toEqual({ ok: false, field: "message" });
    expect(validateFeedback({ ...ok, path: "/a?b=1" })).toEqual({ ok: false, field: "path" });
  });

  it("el mensaje llega hasta el máximo y no más", () => {
    expect(validateFeedback({ ...ok, message: "x".repeat(FEEDBACK_MESSAGE_MAX) }).ok).toBe(true);
    expect(validateFeedback({ ...ok, message: "x".repeat(FEEDBACK_MESSAGE_MAX + 1) }).ok).toBe(
      false,
    );
  });
});

describe("isOverDailyLimit", () => {
  it("bloquea desde el décimo envío ya hecho", () => {
    expect(isOverDailyLimit(FEEDBACK_DAILY_LIMIT - 1)).toBe(false);
    expect(isOverDailyLimit(FEEDBACK_DAILY_LIMIT)).toBe(true);
  });
});
