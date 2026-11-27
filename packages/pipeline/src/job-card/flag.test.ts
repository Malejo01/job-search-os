import { describe, expect, it } from "vitest";
import { jobCardAllowed, jobCardGenerationEnabled, jobCardMode } from "./flag";

const base = { ADMIN_EMAILS: "admin@example.com", ASSISTANT_TESTER_EMAILS: "tester@example.com" };

describe("JOB_CARD", () => {
  it("solo `testers` y `all` encienden; cualquier otro valor es apagado", () => {
    expect(jobCardMode({ JOB_CARD: "testers" })).toBe("testers");
    expect(jobCardMode({ JOB_CARD: " ALL " })).toBe("all");
    for (const v of [undefined, "", "apagado", "off", "1", "true", "tester", "todos"]) {
      expect(jobCardMode({ JOB_CARD: v })).toBe("off");
    }
  });

  it("en `testers` lo ven admins y testers, nadie más", () => {
    const env = { ...base, JOB_CARD: "testers" };
    expect(jobCardAllowed(env, "admin@example.com")).toBe(true);
    expect(jobCardAllowed(env, "TESTER@example.com")).toBe(true);
    expect(jobCardAllowed(env, "otra@example.com")).toBe(false);
    expect(jobCardAllowed(env, null)).toBe(false);
  });

  it("`all` la ve toda persona; apagada por defecto", () => {
    expect(jobCardAllowed({ ...base, JOB_CARD: "all" }, "otra@example.com")).toBe(true);
    expect(jobCardAllowed(base, "admin@example.com")).toBe(false);
  });

  it("la generación en segundo plano solo corre si la variable está encendida", () => {
    expect(jobCardGenerationEnabled({})).toBe(false);
    expect(jobCardGenerationEnabled({ JOB_CARD: "testers" })).toBe(true);
    expect(jobCardGenerationEnabled({ JOB_CARD: "all" })).toBe(true);
  });
});
