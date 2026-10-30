import { describe, expect, it } from "vitest";
import { buildDigest, digestPeriodKey, digestSentence, isoWeek, type DigestInput } from "./build";

const BASE: DigestInput = {
  newEvaluated: 4,
  toApply: 2,
  followUps: 1,
  careers: [{ label: "Data Analyst", last7d: 37 }],
  frequency: "semanal",
  now: new Date("2026-10-23T12:00:00Z"),
  timeZone: "America/Argentina/Buenos_Aires",
  productName: "Producto",
};

describe("buildDigest (C-6 E4)", () => {
  it("arma las líneas con conteos y el mercado solo en el semanal", () => {
    const d = buildDigest(BASE);
    expect(d.hasNews).toBe(true);
    expect(d.lines).toEqual([
      "4 ofertas nuevas evaluadas (2 para postularte)",
      "1 postulación para hacer seguimiento",
      "Data Analyst: 37 ofertas nuevas en 7 días",
    ]);
    expect(buildDigest({ ...BASE, frequency: "diario" }).lines).toHaveLength(2);
  });

  it("sin novedades personales no hay resumen, aunque el mercado se haya movido", () => {
    const d = buildDigest({ ...BASE, newEvaluated: 0, toApply: 0, followUps: 0 });
    expect(d.hasNews).toBe(false);
    expect(digestSentence(d)).toBeNull();
  });

  it("el asunto es neutro: sin números ni carreras", () => {
    const d = buildDigest(BASE);
    expect(d.subject).toBe("Tu resumen de la semana en Producto");
    expect(d.subject).not.toMatch(/\d|Data/);
    expect(buildDigest({ ...BASE, frequency: "diario" }).subject).toBe(
      "Tu resumen del día en Producto",
    );
  });

  it("la frase de «Hoy» junta solo lo personal", () => {
    expect(digestSentence(buildDigest(BASE))).toBe(
      "Desde tu última visita: 4 ofertas nuevas evaluadas (2 para postularte) y 1 postulación para hacer seguimiento.",
    );
    const one = buildDigest({ ...BASE, followUps: 0, toApply: 0, newEvaluated: 1 });
    expect(digestSentence(one)).toBe("Desde tu última visita: 1 oferta nueva evaluada.");
  });

  it("el período sale del día local de la persona, no del de UTC", () => {
    // 01:30 UTC del 24/10 sigue siendo 23/10 en Buenos Aires (UTC-3)
    const late = new Date("2026-10-24T01:30:00Z");
    expect(digestPeriodKey("diario", late, "America/Argentina/Buenos_Aires")).toBe("2026-10-23");
    expect(digestPeriodKey("diario", late, "Europe/Madrid")).toBe("2026-10-24");
    expect(digestPeriodKey("diario", late, "Zona/Inexistente")).toBe("2026-10-24");
  });

  it("la semana es la ISO 8601, también en el cambio de año", () => {
    expect(isoWeek(2026, 10, 23)).toEqual({ year: 2026, week: 43 });
    expect(isoWeek(2027, 1, 1)).toEqual({ year: 2026, week: 53 });
    expect(digestPeriodKey("semanal", BASE.now, BASE.timeZone)).toBe("2026-W43");
  });
});
