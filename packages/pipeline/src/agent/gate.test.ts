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
  it("«testers» es un modo propio; escrito distinto, apagado", () => {
    expect(assistantMode({ ASSISTANT_ENABLED: "testers" })).toBe("testers");
    expect(assistantMode({ ASSISTANT_ENABLED: " testers " })).toBe("testers");
    expect(assistantMode({ ASSISTANT_ENABLED: "Testers" })).toBe("off");
    expect(assistantMode({ ASSISTANT_ENABLED: "tester" })).toBe("off");
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
  it("en modo admin, un tester no entra", () => {
    expect(
      assistantAllowed({ ...env, ASSISTANT_TESTER_EMAILS: "beto@example.com" }, "beto@example.com"),
    ).toBe(false);
  });

  describe("modo testers", () => {
    const t = {
      ASSISTANT_ENABLED: "testers",
      ADMIN_EMAILS: "ana@example.com",
      ASSISTANT_TESTER_EMAILS: " Beto@Example.com , carla@example.com",
    };
    it("entran los admins y los testers, sin mayúsculas ni espacios", () => {
      expect(assistantAllowed(t, "ana@example.com")).toBe(true);
      expect(assistantAllowed(t, "BETO@example.com")).toBe(true);
      expect(assistantAllowed(t, "carla@example.com")).toBe(true);
    });
    it("un usuario común no entra", () => {
      expect(assistantAllowed(t, "dani@example.com")).toBe(false);
      expect(assistantAllowed(t, null)).toBe(false);
    });
    it("un email que está en las dos listas entra", () => {
      expect(
        assistantAllowed({ ...t, ASSISTANT_TESTER_EMAILS: "ana@example.com" }, "ana@example.com"),
      ).toBe(true);
    });
    it("falla cerrado con la lista vacía o ausente (solo admins)", () => {
      expect(assistantAllowed({ ...t, ASSISTANT_TESTER_EMAILS: "" }, "beto@example.com")).toBe(
        false,
      );
      expect(assistantAllowed({ ...t, ASSISTANT_TESTER_EMAILS: " , " }, "")).toBe(false);
      const { ASSISTANT_TESTER_EMAILS: _omit, ...sinLista } = t;
      expect(assistantAllowed(sinLista, "beto@example.com")).toBe(false);
      expect(assistantAllowed(sinLista, "ana@example.com")).toBe(true);
    });
    it("el flag mal escrito apaga todo, tester o admin", () => {
      expect(assistantAllowed({ ...t, ASSISTANT_ENABLED: "Testers" }, "beto@example.com")).toBe(
        false,
      );
      expect(assistantAllowed({ ...t, ASSISTANT_ENABLED: "all" }, "ana@example.com")).toBe(false);
    });
    it("ser tester no hace admin a nadie", () => {
      expect(isAdminEmail("beto@example.com", t.ADMIN_EMAILS)).toBe(false);
    });
  });
});
