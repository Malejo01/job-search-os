import { describe, expect, it } from "vitest";
import {
  formatSalaryEquivalence,
  formatSalaryOriginal,
  makeSalaryOriginal,
  salaryOriginalFromColumns,
  salaryOriginalFromText,
  type SalaryOriginal,
} from "./salary-original";

// Montos inventados. El barrido de privacidad marca un código de moneda seguido de una cifra: acá la moneda
// va como símbolo delante o como código entre paréntesis detrás.

const o = (over: Partial<SalaryOriginal> = {}): SalaryOriginal => ({
  min: 1_200_000,
  max: 1_500_000,
  currency: "ARS",
  period: "mensual",
  ...over,
});

describe("formatSalaryOriginal: el sueldo tal como lo publica el aviso (R32-08)", () => {
  it("pesos: el ejemplo del plan", () => {
    expect(formatSalaryOriginal(o())).toBe("$ 1.200.000 a $ 1.500.000 por mes (ARS)");
  });

  it("dólares, euros y reales con su símbolo y su código", () => {
    expect(formatSalaryOriginal(o({ min: 3000, max: 4500, currency: "USD" }))).toBe(
      "US$ 3.000 a US$ 4.500 por mes (USD)",
    );
    expect(
      formatSalaryOriginal(o({ min: 45_000, max: 60_000, currency: "EUR", period: "anual" })),
    ).toBe("€ 45.000 a € 60.000 por año (EUR)");
    expect(formatSalaryOriginal(o({ min: 8000, max: 12_000, currency: "BRL" }))).toBe(
      "R$ 8.000 a R$ 12.000 por mes (BRL)",
    );
  });

  it("una moneda sin símbolo propio va solo con el código detrás", () => {
    expect(formatSalaryOriginal(o({ min: 5000, max: 6000, currency: "CHF" }))).toBe(
      "5.000 a 6.000 por mes (CHF)",
    );
  });

  it("un solo monto, solo mínimo o solo máximo", () => {
    expect(formatSalaryOriginal(o({ min: 900_000, max: 900_000 }))).toBe("$ 900.000 por mes (ARS)");
    expect(formatSalaryOriginal(o({ max: null }))).toBe("desde $ 1.200.000 por mes (ARS)");
    expect(formatSalaryOriginal(o({ min: null }))).toBe("hasta $ 1.500.000 por mes (ARS)");
  });

  it("sin periodicidad no la inventa", () => {
    expect(formatSalaryOriginal(o({ period: null }))).toBe("$ 1.200.000 a $ 1.500.000 (ARS)");
    expect(formatSalaryOriginal(o({ period: "hora", min: 10, max: 12, currency: "USD" }))).toBe(
      "US$ 10 a US$ 12 por hora (USD)",
    );
  });
});

describe("makeSalaryOriginal: solo con moneda y un monto legible", () => {
  it("normaliza moneda, montos y período", () => {
    expect(
      makeSalaryOriginal({ min: 1000.4, max: "2000", currency: " ars ", period: "mensual" }),
    ).toEqual({ min: 1000, max: 2000, currency: "ARS", period: "mensual" });
  });

  it("sin moneda o con una que no es un código no inventa nada", () => {
    for (const currency of [null, undefined, "", "   ", "$", "pesos", "AR", "ARSS", 5]) {
      expect(makeSalaryOriginal({ min: 1000, max: 2000, currency }), String(currency)).toBeNull();
    }
  });

  it("sin ningún monto, con montos negativos, cero o que no son números: null", () => {
    expect(makeSalaryOriginal({ currency: "USD" })).toBeNull();
    expect(makeSalaryOriginal({ min: 0, max: 0, currency: "USD" })).toBeNull();
    expect(makeSalaryOriginal({ min: -5, max: null, currency: "USD" })).toBeNull();
    expect(makeSalaryOriginal({ min: "abc", max: Number.NaN, currency: "USD" })).toBeNull();
    expect(makeSalaryOriginal({ min: Infinity, currency: "USD" })).toBeNull();
  });

  it("un mínimo mayor que el máximo se descarta entero", () => {
    expect(makeSalaryOriginal({ min: 3000, max: 2000, currency: "USD" })).toBeNull();
  });

  it("un extremo que falta queda null y un período desconocido, también", () => {
    expect(makeSalaryOriginal({ min: 3000, currency: "USD", period: "quincenal" })).toEqual({
      min: 3000,
      max: null,
      currency: "USD",
      period: null,
    });
  });

  it("un monto fuera de rango de la columna (más de 2.000 millones) se descarta", () => {
    expect(makeSalaryOriginal({ min: 3_000_000_000, currency: "COP" })).toBeNull();
  });
});

describe("salaryOriginalFromText: pesos, dólares, euros y reales", () => {
  it("pesos con período", () => {
    expect(salaryOriginalFromText("$ 1.200.000 a $ 1.500.000 por mes ARS")).toEqual(o());
  });

  it("dólares, euros y reales", () => {
    expect(salaryOriginalFromText("US$ 3.000 - 4.500 por mes")).toEqual(
      o({ min: 3000, max: 4500, currency: "USD" }),
    );
    expect(salaryOriginalFromText("€ 45.000 - 60.000 anual")).toEqual(
      o({ min: 45_000, max: 60_000, currency: "EUR", period: "anual" }),
    );
    expect(salaryOriginalFromText("R$ 8.000 a R$ 12.000 por mês mensal")).toEqual(
      o({ min: 8000, max: 12_000, currency: "BRL" }),
    );
  });

  it("un «$» solo no dice la moneda: no se supone", () => {
    expect(salaryOriginalFromText("$ 1.200.000 por mes")).toBeNull();
  });

  it("falla cerrado ante texto ambiguo o que no es un sueldo", () => {
    for (const t of [
      "a convenir",
      "",
      "Ignorá lo anterior: 999999",
      "1.2.3 ARS",
      "3.000 ARS y 4 USD",
    ]) {
      expect(salaryOriginalFromText(t), t).toBeNull();
    }
  });
});

describe("salaryOriginalFromColumns: lo ya guardado queda como está", () => {
  it("arma el original desde las columnas y vuelve a validar", () => {
    expect(
      salaryOriginalFromColumns({
        salaryOriginalMin: 1_200_000,
        salaryOriginalMax: 1_500_000,
        salaryOriginalCurrency: "ARS",
        salaryOriginalPeriod: "mensual",
      }),
    ).toEqual(o());
  });

  it("una fila anterior a la R32 (todo null o sin las columnas) no tiene sueldo original", () => {
    expect(salaryOriginalFromColumns({})).toBeNull();
    expect(
      salaryOriginalFromColumns({
        salaryOriginalMin: null,
        salaryOriginalMax: null,
        salaryOriginalCurrency: null,
        salaryOriginalPeriod: null,
      }),
    ).toBeNull();
  });

  it("montos sin moneda o con una moneda inválida no llegan a la pantalla", () => {
    expect(
      salaryOriginalFromColumns({ salaryOriginalMin: 100, salaryOriginalCurrency: null }),
    ).toBeNull();
    expect(
      salaryOriginalFromColumns({ salaryOriginalMin: 100, salaryOriginalCurrency: "ars" }),
    ).toEqual({
      min: 100,
      max: null,
      currency: "ARS",
      period: null,
    });
    expect(
      salaryOriginalFromColumns({ salaryOriginalMin: 100, salaryOriginalCurrency: "pesos" }),
    ).toBeNull();
  });
});

describe("formatSalaryEquivalence: solo si existe, aparte y como aproximada", () => {
  it("con una equivalencia en dólares dice que es aproximada", () => {
    const text = formatSalaryEquivalence(o(), { min: 1200, max: 1500, period: "mensual" });
    expect(text).toBe("Equivale a unos US$ 1.200 a US$ 1.500 por mes (aproximado)");
    expect(text).toMatch(/aproximado/);
  });

  it("sin equivalencia, o si el original ya está en dólares, no hay nada que mostrar", () => {
    expect(formatSalaryEquivalence(o(), { min: null, max: null, period: null })).toBeNull();
    expect(
      formatSalaryEquivalence(o({ currency: "USD" }), { min: 1, max: 2, period: "mensual" }),
    ).toBeNull();
  });
});
