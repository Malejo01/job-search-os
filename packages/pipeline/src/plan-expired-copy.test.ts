import { describe, expect, it } from "vitest";
import { expiredPlanSummary } from "./plan-expired-copy";

describe("expiredPlanSummary: qué se mantiene y qué se pausa al vencer el plan", () => {
  const s = expiredPlanSummary({ cv: true, assistant: false });

  it("dice que no se borra nada y lista lo que se mantiene", () => {
    expect(s.keeps.join(" ")).toMatch(/datos/i);
    expect(s.keeps.join(" ")).toMatch(/ofertas/i);
    expect(s.keeps.join(" ")).toMatch(/CV/);
    expect(s.keeps.join(" ")).toMatch(/historial/i);
    expect(s.title).not.toMatch(/urgente|última chance|perdés/i);
  });

  it("lo que se pausa sale de los topes reales del plan gratis frente al completo", () => {
    expect(s.pauses.length).toBeGreaterThan(0);
    for (const line of s.pauses) {
      expect(line).toMatch(/tope|por d[ií]a|a la vez|por mes/);
      expect(line).not.toContain("undefined");
    }
  });

  it("la lectura de CV solo aparece si está encendida", () => {
    const sin = expiredPlanSummary({ cv: false, assistant: false });
    expect(s.pauses.join(" ")).toMatch(/CV/);
    expect(sin.pauses.join(" ")).not.toMatch(/lecturas de CV/);
  });

  it("no promete trabajo ni garantías", () => {
    const all = [s.title, s.intro, ...s.keeps, ...s.pauses].join(" ");
    expect(all).not.toMatch(/garant|reintegr|conseguir trabajo|te vamos a conseguir/i);
  });
});
