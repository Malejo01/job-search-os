import { describe, expect, it } from "vitest";
import { assistantAllowed, assistantMode, isAdminEmail } from "./gate";

describe("assistantMode", () => {
  it("solo «admin» lo enciende; todo lo demás es apagado", () => {
    expect(assistantMode({})).toBe("off");
    expect(assistantMode({ ASSISTANT_ENABLED: "" })).toBe("off");
    expect(assistantMode({ ASSISTANT_ENABLED: "1" })).toBe("off");
    expect(assistantMode({ ASSISTANT_ENABLED: "all" })).toBe("off");
    expect(assistantMode({ ASSISTANT_ENABLED: "Admin" })).toBe("off");
    expect(assistantMode({ ASSISTANT_ENABLED: "admin" })).toBe("admin");
    expect(assistantMode({ ASSISTANT_ENABLED: " admin " })).toBe("admin");
  });
});

describe("isAdminEmail", () => {
  it("compara sin mayúsculas ni espacios y exige coincidencia exacta", () => {
    const list = " ana@example.com , Otro@Example.com,";
    expect(isAdminEmail("ANA@example.com ", list)).toBe(true);
    expect(isAdminEmail("otro@example.com", list)).toBe(true);
    expect(isAdminEmail("na@example.com", list)).toBe(false);
    expect(isAdminEmail("", list)).toBe(false);
    expect(isAdminEmail(null, list)).toBe(false);
    expect(isAdminEmail("ana@example.com", undefined)).toBe(false);
    expect(isAdminEmail(" ", " , ")).toBe(false);
  });
});

describe("assistantAllowed", () => {
  const env = { ASSISTANT_ENABLED: "admin", ADMIN_EMAILS: "ana@example.com" };
  it("admin con el flag: sí", () => {
    expect(assistantAllowed(env, "ana@example.com")).toBe(true);
  });
  it("no admin, o sin flag: no", () => {
    expect(assistantAllowed(env, "beto@example.com")).toBe(false);
    expect(assistantAllowed({ ...env, ASSISTANT_ENABLED: undefined }, "ana@example.com")).toBe(
      false,
    );
    expect(assistantAllowed({ ASSISTANT_ENABLED: "admin" }, "ana@example.com")).toBe(false);
  });
});
