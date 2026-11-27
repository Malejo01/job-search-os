import { describe, expect, it } from "vitest";
import { conditionRows, type ConditionsInput } from "../app/(app)/jobs/[id]/conditions-view";

const empty: ConditionsInput = {
  salaryMinUsd: null,
  salaryMaxUsd: null,
  salaryPeriod: null,
  modality: null,
  englishRequired: null,
  yearsRequired: null,
  contractType: null,
};

const get = (input: Partial<ConditionsInput>, key: string) =>
  conditionRows({ ...empty, ...input }).find((r) => r.key === key);

describe("conditionRows", () => {
  it("sin datos, siempre las 7 filas y todas dicen «No especificado»", () => {
    const rows = conditionRows(empty);
    expect(rows.map((r) => r.key)).toEqual([
      "modality",
      "location",
      "salary",
      "seniority",
      "language",
      "hours",
      "contract",
    ]);
    for (const r of rows) {
      expect(r.value).toBe("No especificado");
      expect(r.informed).toBe(false);
    }
  });

  it("sueldo con rango y período", () => {
    const range = get({ salaryMinUsd: 11, salaryMaxUsd: 22, salaryPeriod: "mensual" }, "salary");
    expect(range?.value).toMatch(/^USD 11–22 mensual$/);
    expect(get({ salaryMaxUsd: 22 }, "salary")?.value).toMatch(/^USD 22$/);
  });

  it("R32-08: con el sueldo original, la fila lo muestra tal cual y en su moneda (pesos, dólares, euros, reales)", () => {
    const row = (original: NonNullable<ConditionsInput["salaryOriginal"]>) =>
      get(
        { salaryMinUsd: 11, salaryMaxUsd: 22, salaryPeriod: "mensual", salaryOriginal: original },
        "salary",
      );
    expect(row({ min: 1_200_000, max: 1_500_000, currency: "ARS", period: "mensual" })?.value).toBe(
      "$ 1.200.000 a $ 1.500.000 por mes (ARS)",
    );
    expect(row({ min: 3000, max: 4500, currency: "USD", period: "mensual" })?.value).toBe(
      "US$ 3.000 a US$ 4.500 por mes (USD)",
    );
    expect(row({ min: 45_000, max: 60_000, currency: "EUR", period: "anual" })?.value).toBe(
      "€ 45.000 a € 60.000 por año (EUR)",
    );
    expect(row({ min: 8000, max: null, currency: "BRL", period: null })?.value).toBe(
      "desde R$ 8.000 (BRL)",
    );
    expect(row({ min: 1, max: 2, currency: "ARS", period: "mensual" })?.informed).toBe(true);
  });

  it("R32-08: sin sueldo original (lo guardado antes) la fila sigue como siempre", () => {
    expect(
      get(
        { salaryMinUsd: 11, salaryMaxUsd: 22, salaryPeriod: "mensual", salaryOriginal: null },
        "salary",
      )?.value,
    ).toBe("USD 11–22 mensual");
  });

  it("modalidad desconocida no se informa", () => {
    expect(get({ modality: "desconocida" }, "modality")?.informed).toBe(false);
    expect(get({ modality: "hibrido" }, "modality")?.value).toBe("híbrido");
  });

  it("desde dónde: remoto no se deduce como «cualquier país»", () => {
    expect(get({ modality: "remoto" }, "location")?.informed).toBe(false);
    expect(get({ countriesAllowed: null }, "location")?.value).toBe("No especificado");
    expect(get({ countriesAllowed: [] }, "location")?.informed).toBe(false);
  });

  it("desde dónde: países explícitos, todo el mundo y lista larga recortada", () => {
    expect(get({ countriesAllowed: ["AR", "UY"] }, "location")?.value).toBe("AR, UY");
    expect(get({ countriesAllowed: ["*"] }, "location")?.value).toBe("Desde cualquier país");
    expect(
      get({ countriesAllowed: ["AR", "UY", "CL", "BR", "MX", "CO", "PE"] }, "location")?.value,
    ).toBe("AR, UY, CL, BR, MX y 2 más");
  });

  it("idioma: «no menciona» no se informa, «no pide» sí, y un nivel dice cuál", () => {
    expect(get({ englishRequired: "no_menciona" }, "language")?.informed).toBe(false);
    expect(get({ englishRequired: "no" }, "language")?.value).toBe("No lo pide");
    expect(get({ englishRequired: "avanzado" }, "language")?.value).toBe("Inglés avanzado");
  });

  it("experiencia: años con singular y plural", () => {
    expect(get({ yearsRequired: 1 }, "seniority")?.value).toBe("1 año de experiencia");
    expect(get({ yearsRequired: 4 }, "seniority")?.value).toBe("4 años de experiencia");
  });

  it("jornada: horas semanales del aviso; 0 o ausente no se informa", () => {
    expect(get({ weeklyHours: 40 }, "hours")?.value).toBe("40 h semanales");
    expect(get({ weeklyHours: 0 }, "hours")?.informed).toBe(false);
    expect(get({ weeklyHours: null }, "hours")?.informed).toBe(false);
  });

  it("contratación: texto recortado y vacío cuenta como no informado", () => {
    expect(get({ contractType: "  Tiempo completo " }, "contract")?.value).toBe("Tiempo completo");
    expect(get({ contractType: "   " }, "contract")?.informed).toBe(false);
  });
});
