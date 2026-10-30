import { describe, expect, it } from "vitest";
import { isIsoCountry, REGION_COUNTRIES } from "../countries";
import { COUNTRY_OPTIONS } from "../onboarding";
import {
  countriesMentioned,
  countryNames,
  mentionsCountry,
  mentionsTimeZone,
  normalizeLocation,
} from "./location";
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

describe("outsideRegion: países fuera de la región (N4-2)", () => {
  const outside = { outsideRegion: true };

  it("sin la opción, un texto con 'spain' sigue igual que hoy", () => {
    expect(countriesMentioned(foldText("Remote - Spain"))).toEqual([]);
    expect(countriesMentioned(foldText("Madrid, Spain o Argentina"))).toEqual(["AR"]);
    expect(mentionsCountry(foldText("Remote - Spain"), "ES")).toBe(false);
    expect(mentionsCountry(foldText("Remote - Spain"), "ES", { wholeWord: false })).toBe(false);
  });

  it("mentionsCountry reconoce el país de la persona fuera de la región", () => {
    expect(mentionsCountry(foldText("Remote - Spain"), "ES", outside)).toBe(true);
    expect(mentionsCountry(foldText("Remoto, España"), "es", outside)).toBe(true);
    expect(mentionsCountry(foldText("Remote - United States"), "US", outside)).toBe(true);
    expect(mentionsCountry(foldText("San Francisco, CA"), "US", outside)).toBe(true);
    expect(mentionsCountry(foldText("Remote (Canada)"), "CA", outside)).toBe(true);
    expect(mentionsCountry(foldText("Remote - Europe"), "ES", outside)).toBe(false);
    // Un código sin nombres en ninguna tabla sigue sin reconocerse
    expect(mentionsCountry(foldText("Remote - Iceland"), "IS", outside)).toBe(false);
  });

  it("fuera de la región siempre por palabra entera, aunque se pida prefijo", () => {
    const prefix = { wholeWord: false, outsideRegion: true };
    expect(mentionsCountry(foldText("usual remote"), "US", prefix)).toBe(false);
    expect(mentionsCountry(foldText("Indiana, remote"), "IN", prefix)).toBe(false);
    expect(mentionsCountry(foldText("Spanish speakers"), "ES", prefix)).toBe(false);
    expect(mentionsCountry(foldText("Remote - US-based"), "US", prefix)).toBe(true);
  });

  it("para un país de la región, igual que sin la opción (gentilicios por prefijo)", () => {
    const prefix = { wholeWord: false, outsideRegion: true };
    expect(mentionsCountry(foldText("Peruvian remote"), "PE", prefix)).toBe(true);
    expect(mentionsCountry(foldText("Peruvian remote"), "PE", outside)).toBe(false);
    expect(mentionsCountry(foldText("Remote - New Mexico"), "MX", prefix)).toBe(false);
  });

  it("countriesMentioned suma los países fuera de la región por palabra entera", () => {
    expect(countriesMentioned(foldText("Madrid, Spain"), outside)).toEqual(["ES"]);
    expect(countriesMentioned(foldText("Bangalore, India"), outside)).toEqual(["IN"]);
    expect(countriesMentioned(foldText("Argentina or Spain"), outside)).toEqual(["AR", "ES"]);
    expect(countriesMentioned(foldText("Buenos Aires, Argentina"), outside)).toEqual(["AR"]);
    expect(countriesMentioned(foldText("Indiana, remote"), outside)).toEqual([]);
    expect(countriesMentioned(foldText("usual remote"), outside)).toEqual([]);
    expect(countriesMentioned(foldText("Remote"), outside)).toEqual([]);
    expect(countriesMentioned(foldText("LATAM"), outside)).toEqual([]);
  });

  it("'New Mexico' y 'Nuevo México' son US, no MX", () => {
    expect(countriesMentioned(foldText("New Mexico"), outside)).toEqual(["US"]);
    expect(countriesMentioned(foldText("Albuquerque, Nuevo México"), outside)).toEqual(["US"]);
    expect(countriesMentioned(foldText("New Mexico or Mexico"), outside)).toEqual(["MX", "US"]);
    expect(mentionsCountry(foldText("New Mexico"), "US", outside)).toBe(true);
    expect(mentionsCountry(foldText("New Mexico"), "MX", outside)).toBe(false);
  });
});

describe("nombres de afuera que, con otra palabra antes, son otro lugar (N4-2)", () => {
  const outside = { outsideRegion: true };

  it.each([
    ["Remote - Baja California", "US"],
    ["Tijuana, Baja California, México", "US"],
    ["Remote - New England", "GB"],
    ["Sydney, New South Wales, Australia", "GB"],
    ["Belfast, Northern Ireland", "IE"],
  ])("%j no nombra %s", (loc, code) => {
    expect(mentionsCountry(foldText(loc), code, outside)).toBe(false);
    expect(countriesMentioned(foldText(loc), outside)).not.toContain(code);
  });

  it("la frase entera cuenta como el lugar que sí es", () => {
    expect(countriesMentioned(foldText("Remote - New England"), outside)).toEqual(["US"]);
    expect(countriesMentioned(foldText("Sydney, New South Wales"), outside)).toEqual(["AU"]);
    expect(countriesMentioned(foldText("Belfast, Northern Ireland"), outside)).toEqual(["GB"]);
    expect(countriesMentioned(foldText("Tijuana, Baja California, México"), outside)).toEqual([
      "MX",
    ]);
  });

  it("sin el prefijo, el nombre sigue contando", () => {
    expect(mentionsCountry(foldText("Remote - California"), "US", outside)).toBe(true);
    expect(mentionsCountry(foldText("London, England"), "GB", outside)).toBe(true);
    expect(mentionsCountry(foldText("Cardiff, Wales"), "GB", outside)).toBe(true);
    expect(mentionsCountry(foldText("Dublin, Ireland"), "IE", outside)).toBe(true);
  });
});

describe("mentionsTimeZone (N4-2, mismo criterio que TZ_MENTION del pool)", () => {
  it.each([
    "Remote - LATAM (US hours)",
    "Brazil (US time zone)",
    "Remote - Brazil, overlap with US",
    "Remote, US time-zones",
    "Remote (EST)",
    "Remote, GMT-3",
    "UTC+1 overlapping",
  ])("%j menciona huso u horario", (loc) => {
    expect(mentionsTimeZone(foldText(loc))).toBe(true);
  });

  it.each(["Remote - United States", "Remote - East Coast", "Estonia", "Remote, Spain"])(
    "%j no",
    (loc) => {
      expect(mentionsTimeZone(foldText(loc))).toBe(false);
    },
  );
});
