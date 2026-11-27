import { describe, expect, it } from "vitest";
import { noCoincideLine, requirementPhrase, salaryLine, sinConfirmarLine } from "../lib/card-view";

describe("salaryLine (R30-04)", () => {
  it("sin sueldo publicado: nada", () => {
    expect(salaryLine(null, null, null)).toBeNull();
    expect(salaryLine(0, 0, "mensual")).toBeNull();
  });

  it("rango con moneda y periodicidad", () => {
    expect(salaryLine(350, 870, "mensual")).toBe("USD 350–870 por mes");
    expect(salaryLine(25, 40, "hora")).toBe("USD 25–40 por hora");
    expect(salaryLine(350, 870, "anual")).toBe("USD 350–870 por año");
  });

  it("separa los miles con punto", () => {
    expect(salaryLine(41250, 58900, "anual")).toMatch(/^USD \d{2}\.\d{3}–\d{2}\.\d{3} por año$/);
    expect(salaryLine(41250, null, null)?.replace(/\D/g, "")).toBe("41250");
  });

  it("un solo valor, o igual en los dos extremos", () => {
    expect(salaryLine(null, 870, "mensual")).toBe("USD 870 por mes");
    expect(salaryLine(870, 870, "mensual")).toBe("USD 870 por mes");
  });

  it("sin periodicidad conocida no se inventa una", () => {
    expect(salaryLine(350, 870, null)).toBe("USD 350–870");
    expect(salaryLine(350, 870, "quincenal")).toBe("USD 350–870");
  });

  it("R32-08: con el sueldo original dice lo que publica el aviso, en su moneda", () => {
    const pesos = { min: 1_200_000, max: 1_500_000, currency: "ARS", period: "mensual" as const };
    expect(salaryLine(null, null, null, pesos)).toBe("$ 1.200.000 a $ 1.500.000 por mes (ARS)");
    // aunque haya dólares, manda el original: no se muestra una conversión como si fuera el sueldo
    expect(salaryLine(1200, 1500, "mensual", pesos)).toBe(
      "$ 1.200.000 a $ 1.500.000 por mes (ARS)",
    );
    expect(salaryLine(null, null, null, { ...pesos, currency: "EUR", min: 2000, max: 2500 })).toBe(
      "€ 2.000 a € 2.500 por mes (EUR)",
    );
    expect(salaryLine(null, null, null, { ...pesos, currency: "BRL", min: 8000, max: 9000 })).toBe(
      "R$ 8.000 a R$ 9.000 por mes (BRL)",
    );
  });

  it("R32-08: sin sueldo original (lo guardado antes) la línea es la de siempre", () => {
    expect(salaryLine(350, 870, "mensual", null)).toBe("USD 350–870 por mes");
    expect(salaryLine(null, null, null, null)).toBeNull();
  });
});

describe("requirementPhrase", () => {
  it("baja la primera letra de una palabra común", () => {
    expect(requirementPhrase("Residir en EE. UU.")).toBe("residir en EE. UU.");
    expect(requirementPhrase("Inglés avanzado")).toBe("inglés avanzado");
  });

  it("deja las siglas y los nombres propios como vienen", () => {
    expect(requirementPhrase("SQL")).toBe("SQL");
    expect(requirementPhrase("AWS y Docker")).toBe("AWS y Docker");
  });

  it("recorta espacios", () => {
    expect(requirementPhrase("  5 años  ")).toBe("5 años");
  });
});

describe("líneas de la tarjeta", () => {
  it("«No coincide: …»", () => {
    expect(noCoincideLine({ code: "residencia", pide: "Residir en EE. UU." })).toBe(
      "No coincide: residir en EE. UU.",
    );
  });

  it("«Sin confirmar: a, b»", () => {
    expect(
      sinConfirmarLine([
        { code: "ingles", pide: "Inglés avanzado" },
        { code: "anos", pide: "5 años" },
      ]),
    ).toBe("Sin confirmar: inglés avanzado, 5 años");
  });

  it("sin nada sin confirmar, no hay línea", () => {
    expect(sinConfirmarLine([])).toBeNull();
  });
});
