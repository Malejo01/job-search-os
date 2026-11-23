import { describe, expect, it } from "vitest";
import { cvTailorAllowed, cvTailorMode } from "./flag";
import { CV_TAILOR_MAX_PER_DAY, decideCvTailorStart } from "./limits";

describe("cvTailorMode", () => {
  it("apagado por defecto y ante cualquier valor desconocido", () => {
    for (const v of [undefined, "", "off", "1", "true", "on", "Admin", "testers2", "todos"]) {
      expect(cvTailorMode({ CV_TAILOR: v })).toBe("off");
    }
  });
  it("acepta testers y all, sin importar mayúsculas ni espacios", () => {
    expect(cvTailorMode({ CV_TAILOR: "testers" })).toBe("testers");
    expect(cvTailorMode({ CV_TAILOR: " ALL " })).toBe("all");
  });
});

describe("cvTailorAllowed", () => {
  const env = {
    ADMIN_EMAILS: "admin@example.com",
    ASSISTANT_TESTER_EMAILS: "tester@example.com",
  };
  it("apagado: nadie, ni un admin", () => {
    expect(cvTailorAllowed({ ...env }, "admin@example.com")).toBe(false);
    expect(cvTailorAllowed({ ...env, CV_TAILOR: "raro" }, "admin@example.com")).toBe(false);
  });
  it("testers: admins y testers, no el resto ni sin email", () => {
    const e = { ...env, CV_TAILOR: "testers" };
    expect(cvTailorAllowed(e, "admin@example.com")).toBe(true);
    expect(cvTailorAllowed(e, "Tester@Example.com")).toBe(true);
    expect(cvTailorAllowed(e, "otra@example.com")).toBe(false);
    expect(cvTailorAllowed(e, null)).toBe(false);
  });
  it("all: toda persona con sesión", () => {
    expect(cvTailorAllowed({ ...env, CV_TAILOR: "all" }, "otra@example.com")).toBe(true);
  });
});

describe("decideCvTailorStart", () => {
  it("3 por día", () => {
    expect(CV_TAILOR_MAX_PER_DAY).toBe(3);
    expect(decideCvTailorStart(0)).toEqual({ ok: true, left: 3 });
    expect(decideCvTailorStart(2)).toEqual({ ok: true, left: 1 });
    expect(decideCvTailorStart(3)).toEqual({ ok: false, reason: "daily_limit" });
    expect(decideCvTailorStart(10)).toEqual({ ok: false, reason: "daily_limit" });
  });
});
