import { describe, expect, it } from "vitest";
import golden from "../../../../evals/fixtures/golden.json";
import { normalizeCompany } from "./company";

/**
 * Expectativa por id del golden público (empresas anonimizadas con identidad estable: la misma
 * letra para la misma empresa). Cubre el "Plataforma → Empresa I" (id 10) y el "(vía plataforma
 * en LinkedIn)" (id 33). Los sufijos legales y variantes reales se prueban abajo con nombres sintéticos.
 */
const expectedByGoldenId: Record<number, string> = {
  1: "empresa a",
  2: "empresa b",
  3: "empresa c",
  4: "empresa d",
  5: "empresa e",
  6: "empresa f",
  7: "empresa f",
  8: "empresa g",
  9: "empresa h",
  10: "empresa i",
  11: "empresa j",
  12: "empresa k",
  13: "empresa l",
  14: "empresa m",
  15: "empresa n",
  16: "empresa o",
  17: "empresa n",
  18: "empresa p",
  19: "empresa q",
  20: "empresa q",
  21: "empresa r",
  22: "empresa r",
  23: "empresa r",
  24: "empresa s",
  25: "empresa t",
  26: "empresa u",
  27: "empresa u",
  28: "empresa v",
  29: "empresa w",
  30: "empresa x",
  31: "empresa y",
  32: "empresa z",
  33: "empresa aa",
  34: "empresa ab",
};

const empresaOf = (id: number) => golden.jobs.find((j) => j.id === id)!.empresa;

describe("normalizeCompany", () => {
  it.each(golden.jobs.map((j) => [j.id, j.empresa] as const))("golden id %i: %s", (id, empresa) => {
    expect(normalizeCompany(empresa)).toBe(expectedByGoldenId[id]);
  });

  it("cubre los 34 jobs del golden", () => {
    expect(golden.jobs).toHaveLength(34);
    expect(Object.keys(expectedByGoldenId)).toHaveLength(34);
  });

  it("misma empresa, dos ofertas (ids 6 y 7) normaliza igual", () => {
    expect(normalizeCompany(empresaOf(6))).toBe(normalizeCompany(empresaOf(7)));
  });

  it("misma empresa, aviso duplicado (ids 19 y 20) normaliza igual", () => {
    expect(normalizeCompany(empresaOf(19))).toBe(normalizeCompany(empresaOf(20)));
  });

  it("quita sufijos legales al final, no en el medio", () => {
    expect(normalizeCompany("Acme Inc.")).toBe("acme");
    expect(normalizeCompany("Acme S.A.")).toBe("acme");
    expect(normalizeCompany("Acme S.R.L.")).toBe("acme");
    expect(normalizeCompany("Acme Labs LLC")).toBe("acme");
    expect(normalizeCompany("Acme Technologies Ltd")).toBe("acme technologies");
    expect(normalizeCompany("Inc Magazine")).toBe("inc magazine");
  });

  it("quita 'vía X' y contenido entre paréntesis", () => {
    expect(normalizeCompany("Empresa AA (vía plataforma en LinkedIn)")).toBe("empresa aa");
    expect(normalizeCompany("Acme via Recruiter Co")).toBe("acme");
    expect(normalizeCompany("Acme (a través de Hays)")).toBe("acme");
  });

  it("recruiter → empresa: se queda con la empresa", () => {
    expect(normalizeCompany("Plataforma → Empresa I")).toBe("empresa i");
    expect(normalizeCompany("Hays -> Acme")).toBe("acme");
  });

  it("nunca devuelve vacío si el nombre es solo un sufijo", () => {
    expect(normalizeCompany("Labs")).toBe("labs");
    expect(normalizeCompany("  ")).toBe("");
  });
});
