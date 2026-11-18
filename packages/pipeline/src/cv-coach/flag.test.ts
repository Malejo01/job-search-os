import { describe, expect, it } from "vitest";
import { cvCoachAllowed, cvCoachMode } from "./flag";

const base = {
  CV_IMPORT_ENABLED: "1",
  CV_PROFILE_AGENT: "testers",
  ADMIN_EMAILS: "admin@example.com",
  ASSISTANT_TESTER_EMAILS: "tester@example.com",
};

describe("CV_COACH (ADR-038 §10)", () => {
  it("solo `testers` y `all` encienden; cualquier otro valor es apagado", () => {
    expect(cvCoachMode({ CV_COACH: "testers" })).toBe("testers");
    expect(cvCoachMode({ CV_COACH: " ALL " })).toBe("all");
    for (const v of [undefined, "", "apagado", "off", "1", "true", "tester", "todos"]) {
      expect(cvCoachMode({ CV_COACH: v })).toBe("off");
    }
  });

  it("en `testers` lo ven admins y testers, nadie más", () => {
    const env = { ...base, CV_COACH: "testers" };
    expect(cvCoachAllowed(env, "admin@example.com")).toBe(true);
    expect(cvCoachAllowed(env, "TESTER@example.com")).toBe(true);
    expect(cvCoachAllowed(env, "otra@example.com")).toBe(false);
    expect(cvCoachAllowed(env, null)).toBe(false);
  });

  it("exige el agente de perfil encendido para la misma persona", () => {
    expect(
      cvCoachAllowed(
        { ...base, CV_COACH: "all", CV_PROFILE_AGENT: "apagado" },
        "admin@example.com",
      ),
    ).toBe(false);
    expect(
      cvCoachAllowed({ ...base, CV_COACH: "all", CV_IMPORT_ENABLED: "0" }, "admin@example.com"),
    ).toBe(false);
    // Coach para todos pero el agente solo para testers: una persona común no lo ve
    expect(cvCoachAllowed({ ...base, CV_COACH: "all" }, "otra@example.com")).toBe(false);
    expect(
      cvCoachAllowed({ ...base, CV_COACH: "all", CV_PROFILE_AGENT: "all" }, "otra@example.com"),
    ).toBe(true);
  });

  it("apagado por defecto", () => {
    expect(cvCoachAllowed(base, "admin@example.com")).toBe(false);
  });
});
