import { describe, expect, it } from "vitest";
import { detectProfessionalLicense } from "./licensing";

const detect = (text: string | null, country: string | null = "AR") =>
  detectProfessionalLicense(text, country);

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

  it("es determinista y tolera texto largo", () => {
    const long = `${"palabra ".repeat(10_000)} bar admission`;
    expect(detect(long)).toBeNull();
    expect(detect("Bar admission")).toEqual(detect("Bar admission"));
  });
});
