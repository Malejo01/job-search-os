import { describe, expect, it } from "vitest";
import { detectJobLanguage } from "./language";

const ES =
  "Buscamos un desarrollador para el equipo de producto. Vas a trabajar con los datos de la empresa y con una API en el stack de Node, con deploy en remote. Es un puesto en la oficina del centro y en las tardes.";
const EN =
  "We are looking for an engineer to join our team. You will work with the product group and have a say in the roadmap. Your work is key to this company and the people we serve.";
const PT =
  "Estamos com uma vaga aberta para o nosso time. Você vai trabalhar com uma equipe de produto, e não precisa ser sênior. Nossa empresa tem um ambiente flexível, com benefícios e mais autonomia, ou seja, pelo seu trabalho.";

describe("detectJobLanguage", () => {
  it("español con palabras sueltas en inglés", () => {
    expect(detectJobLanguage(ES, null)).toBe("es");
  });

  it("inglés", () => {
    expect(detectJobLanguage(EN, null)).toBe("en");
  });

  it("portugués", () => {
    expect(detectJobLanguage(PT, null)).toBe("pt");
  });

  it("español con una sección 'English version below'", () => {
    expect(detectJobLanguage(`${ES} English version below.`, null)).toBe("es");
  });

  it("texto corto, vacío o nulo da null", () => {
    expect(detectJobLanguage("React and Node", null)).toBeNull();
    expect(detectJobLanguage("", null)).toBeNull();
    expect(detectJobLanguage(null, null)).toBeNull();
  });

  it("empate entre idiomas da null", () => {
    expect(detectJobLanguage(`${ES} ${EN}`, null)).toBeNull();
  });

  it("la fuente manda, aunque el texto diga otra cosa", () => {
    expect(detectJobLanguage(EN, "es")).toBe("es");
    expect(detectJobLanguage(ES, "EN-US")).toBe("en");
    expect(detectJobLanguage(null, "pt-BR")).toBe("pt");
  });

  it("una fuente rara se ignora y se mira el texto", () => {
    expect(detectJobLanguage(ES, "lang_not_specified")).toBe("es");
    expect(detectJobLanguage(ES, "fr")).toBe("es");
    expect(detectJobLanguage(null, "lang_not_specified")).toBeNull();
  });

  it("recorta el texto largo y es determinista", () => {
    const long = `${"x ".repeat(40_000)}${ES}`;
    expect(detectJobLanguage(long, null)).toBeNull();
    expect(detectJobLanguage(ES, null)).toBe(detectJobLanguage(ES, null));
  });
});
