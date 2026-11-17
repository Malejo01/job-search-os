import { describe, expect, it } from "vitest";
import {
  isProfileAgentTester,
  profileAgentAllowed,
  profileAgentMode,
  profileAgentQuotaExempt,
} from "./flag";

const base = {
  CV_IMPORT_ENABLED: "1",
  ADMIN_EMAILS: "admin@example.com",
  ASSISTANT_TESTER_EMAILS: "Tester@Example.com, otra@example.com",
};

describe("flag CV_PROFILE_AGENT", () => {
  it("default apagado y cualquier valor raro apaga", () => {
    for (const v of [undefined, "", "apagado", "off", "1", "true", "admin", "testersx"]) {
      expect(profileAgentMode({ CV_PROFILE_AGENT: v })).toBe("off");
    }
  });
  it("testers y all, sin importar mayúsculas ni espacios", () => {
    expect(profileAgentMode({ CV_PROFILE_AGENT: " Testers " })).toBe("testers");
    expect(profileAgentMode({ CV_PROFILE_AGENT: "ALL" })).toBe("all");
  });

  it("apagado: nadie, ni el admin", () => {
    expect(profileAgentAllowed({ ...base }, "admin@example.com")).toBe(false);
    expect(profileAgentAllowed({ ...base, CV_PROFILE_AGENT: "apagado" }, "admin@example.com")).toBe(
      false,
    );
  });
  it("testers: admin y testers, nadie más", () => {
    const env = { ...base, CV_PROFILE_AGENT: "testers" };
    expect(profileAgentAllowed(env, "ADMIN@example.com")).toBe(true);
    expect(profileAgentAllowed(env, "tester@example.com")).toBe(true);
    expect(profileAgentAllowed(env, "otra@example.com")).toBe(true);
    expect(profileAgentAllowed(env, "alguien@example.com")).toBe(false);
    expect(profileAgentAllowed(env, null)).toBe(false);
    expect(profileAgentAllowed(env, undefined)).toBe(false);
  });
  it("all: toda persona con sesión", () => {
    expect(profileAgentAllowed({ ...base, CV_PROFILE_AGENT: "all" }, "alguien@example.com")).toBe(
      true,
    );
  });
  it("sin CV_IMPORT_ENABLED=1 todo queda apagado, incluso con all", () => {
    for (const imp of [undefined, "", "0", "true", "all"]) {
      const env = { ...base, CV_IMPORT_ENABLED: imp, CV_PROFILE_AGENT: "all" };
      expect(profileAgentAllowed(env, "admin@example.com")).toBe(false);
    }
  });

  it("cupo sin tope: admin y testers, con cualquier flag; el resto no", () => {
    expect(profileAgentQuotaExempt(base, "admin@example.com")).toBe(true);
    expect(profileAgentQuotaExempt(base, "tester@example.com")).toBe(true);
    expect(profileAgentQuotaExempt({ ...base, CV_PROFILE_AGENT: "all" }, "x@example.com")).toBe(
      false,
    );
    expect(profileAgentQuotaExempt({}, "admin@example.com")).toBe(false);
    expect(isProfileAgentTester(base, "")).toBe(false);
  });
});
