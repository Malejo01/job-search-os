import { describe, expect, it } from "vitest";
import { detectProfessionalLicense } from "./licensing";

const detect = (text: string | null, country: string | null = "AR", locationRaw?: string | null) =>
  detectProfessionalLicense(text, country, locationRaw);

describe("detectProfessionalLicense", () => {
  describe("reconoce el conjunto estricto", () => {
    it.each([
      ["You must be licensed in your state", "must be licensed"],
      ["Licensed to practice law", "licensed to practice"],
      ["Licensed attorney preferred", "licensed attorney"],
      ["Professional license required", "professional license"],
      ["Professional licensure is a plus", "professional licensure"],
      ["Active state license", "state license"],
      ["State licence needed", "state licence"],
      ["Bar admission in any US state", "bar admission"],
      ["Admitted to the bar", "admitted to the bar"],
      ["Admitted to practice in New York", "admitted to practice"],
      ["Current RN license", "rn license"],
      ["Registered nurse with 3 years", "registered nurse"],
      ["Nursing license in good standing", "nursing license"],
      ["Law license from any jurisdiction", "law license"],
      ["Medical license", "medical license"],
      ["Board certified physician", "board certified"],
      ["Certified Public Accountant", "certified public accountant"],
      ["NMLS ID required", "nmls"],
      ["Series 7 and Series 63", "series 7"],
      ["Series 65 holder", "series 65"],
      ["Series 66", "series 66"],
      ["Matrícula profesional vigente", "matricula profesional"],
      ["Matrícula habilitante", "matricula habilitante"],
      ["Abogada colegiada", "colegiada"],
      ["Contador colegiado", "colegiado"],
      ["A valid license required for this role", "license required"],
      ["Professional licence required", "professional licence"],
    ])("%s", (text, term) => {
      const r = detect(text, "MX");
      expect(r?.term).toBe(term);
      expect(r?.ownCountry).toBe(false);
      expect(r?.phrase.length).toBeGreaterThan(0);
    });
  });

  describe("no reconoce", () => {
    it.each([
      "Valid driver's license required",
      "A valid drivers license is required",
      "Driver’s license required",
      "Licencia de conducir: license required",
      "Candidates must be licensed to drive in the state",
      "Drivers must be licensed and insured",
      "Licensed under the MIT license",
      "This software is licensed to our customers",
      "Reduce the cost per acquisition (CPA)",
      "We are a CPA firm",
      "Apoyo para colegiaturas",
      "Series B startup",
      "Series A and Series C investors",
      "Our board of directors",
      "Matrícula escolar",
      "matrícula sola",
      "We license our software",
      "",
    ])("%s", (text) => {
      expect(detect(text)).toBeNull();
    });

    it("texto nulo o en blanco", () => {
      expect(detect(null)).toBeNull();
      expect(detect("   ")).toBeNull();
    });
  });

  describe("país de la persona", () => {
    it("con el país nombrado al lado, la licencia es del propio país", () => {
      const r = detect("Se requiere matrícula profesional en Argentina.", "AR");
      expect(r).toMatchObject({ term: "matricula profesional", ownCountry: true });
    });

    it("con el nombre en inglés también", () => {
      expect(detect("Bar admission in Brazil preferred", "BR")?.ownCountry).toBe(true);
    });

    it("con otro país al lado no es la propia", () => {
      expect(detect("Se requiere matrícula profesional en Chile.", "AR")?.ownCountry).toBe(false);
    });

    it("el país nombrado lejos (más de 120 caracteres) no cuenta", () => {
      const far = `${"x ".repeat(80)}Argentina`;
      expect(detect(`Bar admission required. ${far}`, "AR")?.ownCountry).toBe(false);
    });

    it("ante varias frases, si una es del propio país manda esa", () => {
      const text = `Bar admission in Chile.${" y".repeat(100)} Matrícula profesional en Argentina.`;
      expect(detect(text, "AR")).toMatchObject({ term: "matricula profesional", ownCountry: true });
    });

    it("con país desconocido nunca es la propia", () => {
      expect(detect("Matrícula profesional en Argentina", null)?.ownCountry).toBe(false);
    });
  });

  describe("contaduría (C-2b)", () => {
    it.each([
      ["Licensed CPA with 3 years of experience", "licensed cpa"],
      ["Active CPA in good standing", "active cpa"],
      ["Current CPA", "current cpa"],
      ["CPA license required", "cpa license"],
      ["CPA licensure", "cpa licensure"],
      ["CPA required", "cpa required"],
      ["CPA certification required", "cpa certification required"],
      ["You must be a CPA", "must be a cpa"],
      // «active cpa» se reconoce primero (misma frase, otro patrón)
      ["Must hold an active CPA", "active cpa"],
      ["Must hold a CPA", "must hold a cpa"],
      ["Enrolled Agent (EA) status", "enrolled agent"],
      ["Contador Público Matriculado", "contador publico matriculado"],
      ["Contadora matriculada", "contadora matriculada"],
      ["Contadores públicos matriculados", "contadores publicos matriculados"],
    ])("reconoce: %s", (text, term) => {
      const r = detect(text, "MX");
      expect(r?.term).toBe(term);
      expect(r?.ownCountry).toBe(false);
      expect(r?.preferred).toBe(false);
    });

    it.each([
      "Reduce the cost per acquisition (CPA)",
      "Improve CPA and ROAS on paid channels",
      "We are a CPA firm",
      "Título de Contador Público",
      "Contador Público (título universitario)",
      "Contador público con experiencia en impuestos",
    ])("no hace nada: %s", (text) => {
      expect(detect(text, "MX")).toBeNull();
    });

    it.each([
      "Licensed CPA preferred",
      "Licensed CPA is a plus",
      "CPA license a plus",
      "CPA license nice to have",
      "CPA license desirable",
      "CPA license or equivalent",
      "Active CPA or working toward CPA",
      "Contador público matriculado deseable",
      "Contador público matriculado valorable",
      "Contador público matriculado o en curso",
    ])("preferido, no excluyente: %s", (text) => {
      // «CPA» suelto no es una frase del conjunto: todas llevan una frase que sí lo es.
      const r = detect(text, "MX");
      expect(r, text).not.toBeNull();
      expect(r?.preferred, text).toBe(true);
    });

    it("«preferably» o «preferentemente» antes de la frase también la hace preferida", () => {
      expect(detect("Preferably a licensed CPA", "MX")?.preferred).toBe(true);
      expect(detect("Preferentemente contador público matriculado", "MX")?.preferred).toBe(true);
    });

    it("«required» y lo lejano no la hacen preferida", () => {
      expect(detect("CPA required", "MX")?.preferred).toBe(false);
      const far = `CPA required.${" y".repeat(40)} preferred`;
      expect(detect(far, "MX")?.preferred).toBe(false);
    });

    it("ante dos frases, la excluyente manda sobre la preferida", () => {
      const r = detect("Licensed CPA preferred. Bar admission in New York required.", "MX");
      expect(r).toMatchObject({ term: "bar admission", preferred: false });
    });

    it("S-1: la ventana de «preferred» se corta en el fin de oración o de línea", () => {
      expect(detect("CPA license required. NetSuite preferred", "MX")?.preferred).toBe(false);
      expect(detect("CPA license required; NetSuite preferred", "MX")?.preferred).toBe(false);
      expect(detect("CPA license required\nNetSuite preferred", "MX")?.preferred).toBe(false);
      expect(detect("Licensed CPA preferred.", "MX")?.preferred).toBe(true);
      expect(detect("Preferably. Licensed CPA required", "MX")?.preferred).toBe(false);
      expect(detect("Preferably a licensed CPA", "MX")?.preferred).toBe(true);
    });

    it("S-2: otro país en la ventana de la frase anula la ubicación propia", () => {
      const us = "must hold an active CPA license in the United States";
      expect(detect(us, "AR", "Argentina")?.ownCountry).toBe(false);
      expect(detect("Licensed CPA required in Chile", "AR", "Argentina")?.ownCountry).toBe(false);
      expect(detect("Licensed CPA required", "AR", "Remote, Argentina")?.ownCountry).toBe(true);
    });

    it("cpce y facpce son de Argentina", () => {
      expect(detect("Contador público matriculado en el CPCE", "AR")?.ownCountry).toBe(true);
      expect(detect("Matriculado FACPCE: contador público matriculado", "AR")?.ownCountry).toBe(
        true,
      );
      expect(detect("Contador público matriculado en el CPCE", "MX")?.ownCountry).toBe(false);
    });

    it("la ubicación del aviso que nombra el país de la persona hace propia la licencia", () => {
      expect(detect("CPA required", "AR", "Buenos Aires, Argentina")?.ownCountry).toBe(true);
      expect(detect("CPA required", "AR", "Remote")?.ownCountry).toBe(false);
      expect(detect("CPA required", "AR", "Santiago, Chile")?.ownCountry).toBe(false);
      expect(detect("CPA required", null, "Buenos Aires, Argentina")?.ownCountry).toBe(false);
    });
  });

  it("es determinista y tolera texto largo", () => {
    const long = `${"palabra ".repeat(10_000)} bar admission`;
    expect(detect(long)).toBeNull();
    expect(detect("Bar admission")).toEqual(detect("Bar admission"));
  });
});
