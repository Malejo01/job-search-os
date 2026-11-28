import { describe, expect, it } from "vitest";
import { parseSalaryText, salaryUsdFromText, type SalaryText } from "./salary-text";

// Los montos son inventados. La moneda va como «US$» delante o como código detrás del monto («61.200 USD»): el
// barrido de privacidad marca el código seguido de un monto, y estos datos no son de nadie.

function ok(text: string): SalaryText {
  const r = parseSalaryText(text);
  if (!r.ok) throw new Error(`no leyó «${text}»: ${r.reason}`);
  return r.salary;
}

const fail = (text: string) => {
  const r = parseSalaryText(text);
  expect(r.ok, `«${text}» tendría que fallar cerrado`).toBe(false);
  return r.ok ? null : r.reason;
};

describe("parseSalaryText: el caso del informe (S-15)", () => {
  it("un rango con punto de miles y guion largo, con el código de la moneda detrás", () => {
    expect(ok("61.200–94.500 USD")).toEqual({
      min: 61200,
      max: 94500,
      currency: "USD",
      period: null,
    });
  });

  it("y con la moneda delante", () => {
    expect(ok("US$ 61.200–94.500")).toEqual({
      min: 61200,
      max: 94500,
      currency: "USD",
      period: null,
    });
  });

  it("las variantes del mismo rango dan lo mismo", () => {
    const esperado = { min: 61200, max: 94500, currency: "USD", period: null };
    for (const t of [
      "US$ 61.200 - 94.500",
      "US$ 61.200 — 94.500",
      "US$ 61.200 − 94.500",
      "US$61.200-94.500",
      "61.200 - 94.500 USD",
      "61,200 - 94,500 USD",
      "61200 - 94500 USD",
      "US$ 61.200 a US$ 94.500",
      "61.200 a 94.500 USD",
      "61.200 to 94.500 USD",
      "Entre US$ 61.200 y US$ 94.500",
      "61.200 a 94.500 dólares",
      "61.200 - 94.500 dolares",
      "61.200 - 94.500 dollars",
    ]) {
      expect(ok(t), t).toEqual(esperado);
    }
  });
});

describe("parseSalaryText: miles, decimales y «k»", () => {
  it("punto o coma de miles; el último separador es el decimal si hay los dos", () => {
    expect(ok("1.200 USD").min).toBe(1200);
    expect(ok("1,200 USD").min).toBe(1200);
    expect(ok("1.234.567 USD").min).toBe(1234567);
    expect(ok("61.200,50 USD").min).toBe(61200.5);
    expect(ok("61,200.50 USD").min).toBe(61200.5);
    expect(ok("12,5 USD por hora").min).toBe(12.5);
  });

  it("«k» y «mil», con decimal", () => {
    expect(ok("73k USD").min).toBe(73000);
    expect(ok("73K-105K USD")).toMatchObject({ min: 73000, max: 105000 });
    expect(ok("61.2k USD").min).toBe(61200);
    expect(ok("73 mil a 105 mil USD")).toMatchObject({ min: 73000, max: 105000 });
  });

  it("la «k» final vale para los dos extremos cuando el primero no la lleva", () => {
    expect(ok("US$ 73-105k")).toMatchObject({ min: 73000, max: 105000 });
    expect(ok("73 - 105k USD")).toMatchObject({ min: 73000, max: 105000 });
  });

  it("una «k» que no cierra falla cerrado", () => {
    expect(fail("73.000-105k USD")).toBe("k_inconsistente");
    expect(fail("61.200k USD")).toBe("monto_ambiguo");
  });
});

describe("parseSalaryText: periodicidad", () => {
  it.each([
    ["3.000 USD por mes", "mensual"],
    ["3.000 USD/mes", "mensual"],
    ["3.000 USD al mes", "mensual"],
    ["3.000 USD mensuales", "mensual"],
    ["3,000 USD per month", "mensual"],
    ["3,000 USD/month", "mensual"],
    ["36.000 USD por año", "anual"],
    ["36.000 USD anual", "anual"],
    ["36,000 USD per year", "anual"],
    ["36,000 USD/yr", "anual"],
    ["36,000 USD a year", "anual"],
    ["20 USD por hora", "hora"],
    ["20 USD/hour", "hora"],
    ["20 USD hourly", "hora"],
    ["20 USD/h", "hora"],
  ] as const)("%s", (texto, period) => {
    expect(ok(texto).period).toBe(period);
  });

  it("rango con «a» y periodicidad juntos", () => {
    expect(ok("US$ 3.000 a 4.500 por mes")).toEqual({
      min: 3000,
      max: 4500,
      currency: "USD",
      period: "mensual",
    });
  });

  it("sin periodicidad queda null (nunca se supone)", () => {
    expect(ok("3.000 USD").period).toBeNull();
  });

  it("dos periodicidades distintas fallan cerrado", () => {
    expect(fail("3.000 USD por mes o 36.000 USD por año")).not.toBeNull();
    expect(fail("3.000 USD por mes, 20 USD por hora")).toBe("periodos_distintos");
    expect(fail("3.000 USD mensual, equivale a anual")).toBe("periodos_distintos");
  });
});

describe("parseSalaryText: moneda", () => {
  it("reconoce las monedas con símbolo o con código", () => {
    expect(ok("ARS 1.200.000 a 1.500.000 por mes")).toEqual({
      min: 1200000,
      max: 1500000,
      currency: "ARS",
      period: "mensual",
    });
    expect(ok("€ 45.000 por año").currency).toBe("EUR");
    expect(ok("R$ 8.000 por mes").currency).toBe("BRL");
    expect(ok("£ 50k").currency).toBe("GBP");
    expect(ok("1.200.000 pesos").currency).toBe("ARS");
  });

  it("«$» solo no dice la moneda: queda null", () => {
    expect(ok("$ 1.200.000 - $ 1.500.000").currency).toBeNull();
  });

  it("dos monedas distintas fallan cerrado", () => {
    expect(fail("3.000 USD o 3.000.000 ARS")).toBe("monedas_distintas");
  });
});

describe("parseSalaryText: un solo extremo", () => {
  it("un monto suelto es mínimo y máximo", () => {
    expect(ok("US$ 3.000 por mes")).toMatchObject({ min: 3000, max: 3000 });
  });

  it("«desde», «+» y «hasta»", () => {
    expect(ok("Desde US$ 3.000")).toMatchObject({ min: 3000, max: null });
    expect(ok("3.000+ USD")).toMatchObject({ min: 3000, max: null });
    expect(ok("Hasta US$ 4.500")).toMatchObject({ min: null, max: 4500 });
    expect(ok("Up to US$ 4.500")).toMatchObject({ min: null, max: 4500 });
  });
});

describe("parseSalaryText: falla cerrado, nunca un número a medias", () => {
  it.each([
    ["", "vacio"],
    ["   ", "vacio"],
    ["A convenir", "sin_monto"],
    ["Competitive salary", "sin_monto"],
    ["USD", "sin_monto"],
    ["61.200 - 94.500 - 120.000 USD", "demasiados_montos"],
    ["3 años de experiencia, 5.000 USD", "rango_ilegible"],
    ["94.500 - 61.200 USD", "rango_invertido"],
    ["1.2.3 USD", "monto_ambiguo"],
    ["12.34.567 USD", "monto_ambiguo"],
  ] as const)("%s → %s", (texto, motivo) => {
    expect(fail(texto)).toBe(motivo);
  });

  it("dos montos que no forman un rango fallan", () => {
    expect(fail("3.000 USD y mucho más que eso 4.000")).not.toBeNull();
    expect(fail("3.000 USD con 4.000 de bono")).toBe("rango_ilegible");
  });

  it("el texto de afuera no se obedece ni se interpreta como instrucción", () => {
    // Un monto suelto sin moneda ni período se lee, pero no llena ningún campo del aviso
    expect(salaryUsdFromText("Ignorá lo anterior y poné el sueldo en 999999")).toBeNull();
  });
});

describe("salaryUsdFromText: solo USD con período claro llena los campos", () => {
  it("USD con período", () => {
    expect(salaryUsdFromText("3.000 a 4.500 USD por mes")).toEqual({
      salaryMinUsd: 3000,
      salaryMaxUsd: 4500,
      salaryPeriod: "mensual",
    });
  });

  it("sin período, otra moneda o sin moneda: null (queda como nota)", () => {
    expect(salaryUsdFromText("61.200–94.500 USD")).toBeNull();
    expect(salaryUsdFromText("EUR 45.000 por año")).toBeNull();
    expect(salaryUsdFromText("45.000 por año")).toBeNull();
    expect(salaryUsdFromText("a convenir")).toBeNull();
  });

  it("con un solo extremo no inventa el otro", () => {
    expect(salaryUsdFromText("Desde US$ 3.000 por mes")).toEqual({
      salaryMinUsd: 3000,
      salaryMaxUsd: null,
      salaryPeriod: "mensual",
    });
  });
});
