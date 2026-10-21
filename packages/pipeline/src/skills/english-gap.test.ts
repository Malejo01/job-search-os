import { describe, expect, it } from "vitest";
import { englishIsNotAGap, isEnglishGap } from "./english-gap";

const ES_BASE =
  "Buscamos una persona para desarrollar la plataforma de la empresa. Trabajarás con el equipo " +
  "de producto en las tareas del día a día y tendrás que participar en las reuniones del equipo. " +
  "Ofrecemos un buen ambiente para trabajar con las herramientas que necesites.";

describe("englishIsNotAGap", () => {
  it("español sin mención de inglés: oculta", () => {
    expect(englishIsNotAGap(ES_BASE, null)).toBe(true);
  });
  it("español que pide inglés intermedio excluyente: no oculta", () => {
    expect(englishIsNotAGap(`${ES_BASE}\nRequisitos: inglés intermedio excluyente.`, null)).toBe(
      false,
    );
  });
  it("aviso en inglés: no oculta", () => {
    const en =
      "We are looking for a person to build the platform of the company. You will work with the " +
      "product team on the daily tasks and you will have to join the meetings of the team.";
    expect(englishIsNotAGap(en, null)).toBe(false);
  });
  it("español con 'English version below' sin pedirlo: oculta", () => {
    expect(englishIsNotAGap(`${ES_BASE}\nEnglish version below.`, null)).toBe(true);
  });
  it("texto vacío o nulo: no oculta", () => {
    expect(englishIsNotAGap("", null)).toBe(false);
    expect(englishIsNotAGap(null, "es")).toBe(false);
  });
  it("idioma desconocido: no oculta", () => {
    expect(englishIsNotAGap("React y Node", null)).toBe(false);
  });
});

describe("isEnglishGap", () => {
  it.each([
    "inglés",
    "Inglés avanzado",
    "English",
    "english C1",
    "INGLES técnico",
    "english_fluent",
  ])("%s es de inglés", (s) => expect(isEnglishGap(s)).toBe(true));
  it.each(["React", "Ingeniería de datos", "Englishman Pro", "", "Liderazgo"])(
    "%s no es de inglés",
    (s) => expect(isEnglishGap(s)).toBe(false),
  );
});
