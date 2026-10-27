import { describe, expect, it } from "vitest";
import { isIsoCountry, REGION_COUNTRIES } from "../countries";
import { COUNTRY_OPTIONS } from "../onboarding";
import { countriesMentioned, countryNames, mentionsCountry, normalizeLocation } from "./location";
import { foldText } from "./text";

describe("normalizeLocation", () => {
  it.each([
    ["Buenos Aires, Argentina", "buenos aires, argentina"],
    ["  Córdoba   Capital ", "cordoba capital"],
    ["Argentina (En remoto)", "argentina"],
    ["Latam - Remote", "latam"],
    ["Remoto, Argentina", "argentina"],
    ["Mexico [Híbrido]", "mexico"],
  ])("%j → %j", (input, expected) => {
    expect(normalizeLocation(input)).toBe(expected);
  });

  it.each([null, undefined, "", "   ", "Remoto", "Remote", "(Remoto)", " - "])(
    "%j no dice nada → null",
    (input) => {
      expect(normalizeLocation(input)).toBeNull();
    },
  );
});

describe("países de la región: una sola tabla (JS-111)", () => {
  it("COUNTRY_OPTIONS del onboarding sale de la tabla, en el mismo orden", () => {
    expect(COUNTRY_OPTIONS).toEqual(REGION_COUNTRIES.map(({ code, label }) => ({ code, label })));
  });

  it("countryNames de cada país es su label plegado más los alias", () => {
    for (const { code, label, aliases } of REGION_COUNTRIES) {
      expect(countryNames(code), code).toEqual([foldText(label), ...aliases]);
      expect(countryNames(code.toLowerCase()), code).toEqual(countryNames(code));
      expect(isIsoCountry(code), code).toBe(true);
    }
  });

  it("cada opción del onboarding se reconoce por su label en un texto", () => {
    for (const { code, label } of COUNTRY_OPTIONS) {
      expect(countriesMentioned(foldText(`Remoto (${label})`)), label).toEqual([code]);
      expect(mentionsCountry(foldText(`Remoto (${label})`), code), label).toBe(true);
    }
  });

  it("un país fuera de la tabla no tiene nombres ni se menciona", () => {
    expect(countryNames("ES")).toEqual([]);
    expect(mentionsCountry(foldText("Remote - Spain only"), "ES")).toBe(false);
    expect(mentionsCountry(foldText("Remote, Estados Unidos"), "ES")).toBe(false);
  });
});

describe("countriesMentioned / mentionsCountry (JS-111)", () => {
  it.each(["Remote - New Mexico, USA", "Albuquerque, Nuevo México", "Remote (new  mexico)"])(
    "%j no menciona México",
    (loc) => {
      expect(countriesMentioned(foldText(loc))).not.toContain("MX");
      expect(mentionsCountry(foldText(loc), "MX")).toBe(false);
    },
  );

  it.each([
    "Mexico City",
    "Ciudad de México",
    "Nuevo León, México",
    "Remoto (México)",
    "New Mexico or Mexico",
  ])("%j menciona México", (loc) => {
    expect(countriesMentioned(foldText(loc))).toContain("MX");
    expect(mentionsCountry(foldText(loc), "MX")).toBe(true);
  });

  it("el nombre se busca como palabra, no como subcadena", () => {
    expect(mentionsCountry(foldText("Peruvian remote"), "PE")).toBe(false);
    expect(mentionsCountry(foldText("Chilean office"), "CL")).toBe(false);
    // Por prefijo (lo que usa el prefiltro) los gentilicios cuentan; "New Mexico" sigue afuera
    const prefix = { wholeWord: false };
    expect(mentionsCountry(foldText("Peruvian remote"), "PE", prefix)).toBe(true);
    expect(mentionsCountry(foldText("empresas argentinas"), "AR", prefix)).toBe(true);
    expect(mentionsCountry(foldText("Brazilian residents"), "BR", prefix)).toBe(true);
    expect(mentionsCountry(foldText("Remote - New Mexico"), "MX", prefix)).toBe(false);
    expect(mentionsCountry(foldText("Brasil o Argentina"), "ar")).toBe(true);
  });
});
