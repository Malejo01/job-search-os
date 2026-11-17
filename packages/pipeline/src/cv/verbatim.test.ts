import { describe, expect, it } from "vitest";
import { cvVerbatim, CV_VERBATIM_MIN_CHARS } from "./verbatim";

const CV = [
  "EXPERIENCIA",
  "Analista contable, Empresa C, 2019-03 a 2024-08",
  "- Cierre mensual de cuentas por pagar   y por cobrar.",
  "- Conciliaciones bancarias de tres",
  "  sociedades.",
  "• Armé tableros de gastos en Excel para la gerencia.",
].join("\n");

describe("cvVerbatim (ADR-038 §7, D4)", () => {
  it("devuelve el texto tal cual está en el CV, con espacios colapsados", () => {
    expect(cvVerbatim(CV, "Cierre mensual de cuentas por pagar y por cobrar.")).toBe(
      "Cierre mensual de cuentas por pagar y por cobrar.",
    );
  });

  it("compara sin mayúsculas ni acentos, pero devuelve la versión del CV", () => {
    expect(cvVerbatim(CV, "arme TABLEROS de gastos en excel para la gerencia")).toBe(
      "Armé tableros de gastos en Excel para la gerencia",
    );
  });

  it("une una viñeta partida en dos líneas", () => {
    expect(cvVerbatim(CV, "Conciliaciones bancarias de tres sociedades.")).toBe(
      "Conciliaciones bancarias de tres sociedades.",
    );
  });

  it("acepta el marcador de viñeta del modelo y lo saca", () => {
    expect(cvVerbatim(CV, "- Conciliaciones bancarias de tres sociedades")).toBe(
      "Conciliaciones bancarias de tres sociedades",
    );
    expect(cvVerbatim(CV, "• Armé tableros de gastos en Excel")).toBe(
      "Armé tableros de gastos en Excel",
    );
  });

  it("una viñeta que no es substring del texto leído se descarta", () => {
    // reescrita, con un número inventado o resumida con otras palabras
    expect(cvVerbatim(CV, "Lideré el cierre mensual de 5 sociedades.")).toBeNull();
    expect(cvVerbatim(CV, "Cierre mensual de cuentas a pagar.")).toBeNull();
    expect(cvVerbatim(CV, "Conciliaciones bancarias de cuatro sociedades.")).toBeNull();
  });

  it("vacía o demasiado corta: nada", () => {
    expect(cvVerbatim(CV, "")).toBeNull();
    expect(cvVerbatim(CV, "   ")).toBeNull();
    expect(cvVerbatim(CV, "Excel")).toBeNull();
    expect("Excel".length).toBeLessThan(CV_VERBATIM_MIN_CHARS);
  });

  it("caracteres compuestos y descompuestos cuentan igual", () => {
    const nfd = "Armé tableros de gastos";
    expect(cvVerbatim(CV, nfd)).toBe("Armé tableros de gastos");
    expect(cvVerbatim(CV.normalize("NFD"), "Armé tableros de gastos")).toBe(
      "Armé tableros de gastos",
    );
  });
});
