import { describe, expect, it } from "vitest";
import { allowsCountry, locationScope } from "./location-scope";

const allows = (
  locationRaw: string | null,
  countriesAllowed: readonly string[] | null,
  iso = "AR",
) => allowsCountry(locationScope(locationRaw, countriesAllowed), iso);

describe("locationScope", () => {
  it("countriesAllowed con '*' es any", () => {
    expect(locationScope("Remote - US", ["*"])).toEqual({ kind: "any" });
  });

  it("countriesAllowed con códigos manda sobre el texto", () => {
    expect(locationScope("Remote", ["CL", "MX"])).toEqual({
      kind: "places",
      countries: ["CL", "MX"],
      regions: [],
    });
  });

  it("'San Francisco or LATAM': incluye US y la región LATAM, y admite AR", () => {
    const scope = locationScope("San Francisco or LATAM", null);
    expect(scope).toMatchObject({ kind: "places", regions: ["LATAM"] });
    expect(scope).toMatchObject({ countries: expect.arrayContaining(["US"]) });
    expect(allowsCountry(scope, "AR")).toBe(true);
  });

  it("'Remote' a secas, vacío o sin país: unknown", () => {
    for (const t of [
      "Remote",
      "",
      "  ",
      null,
      "Remoto",
      "Países no especificados",
      "Remote - Anywhere",
    ]) {
      expect(locationScope(t, null), String(t)).toEqual({ kind: "unknown" });
    }
    expect(locationScope("Remote", [])).toEqual({ kind: "unknown" });
  });

  it("separadores y guiones: 'Remote - US', 'US-Remote'", () => {
    expect(locationScope("Remote - US", null)).toEqual({
      kind: "places",
      countries: ["US"],
      regions: [],
    });
    expect(locationScope("US-Remote", null)).toMatchObject({ kind: "places", countries: ["US"] });
  });

  it("u.s. y ee. uu. se normalizan", () => {
    expect(locationScope("Remote (U.S.)", null)).toMatchObject({ countries: ["US"] });
    expect(locationScope("Remote U.S.A.", null)).toMatchObject({ countries: ["US"] });
    expect(locationScope("Remoto (EE. UU.)", null)).toMatchObject({ countries: ["US"] });
  });

  it("'us' no aparece dentro de otras palabras", () => {
    expect(locationScope("Austin, Columbus", null)).toEqual({ kind: "unknown" });
  });

  it("husos y horarios no restringen el país: unknown", () => {
    for (const t of [
      "Remote - US time zones",
      "Remote (US hours)",
      "EST/PST overlap",
      "Remote, overlap with US",
      "Remote - overlap with the US time zone",
      "Remote - Canada working hours",
      "Remote GMT-3 to GMT+1",
      "Remote, UTC-5",
      "Remote - CST/MST",
    ]) {
      expect(locationScope(t, null), t).toEqual({ kind: "unknown" });
    }
    expect(allowsCountry(locationScope("Remote - US time zones", null), "AR")).toBe(true);
  });

  it("una mención de huso en cualquier parte deja todo en unknown (falla abierto)", () => {
    for (const t of [
      "Remote - Colombia, US hours",
      "Remote - US only, overlap with LATAM",
      "Remote (US or LATAM time zones)",
    ]) {
      expect(locationScope(t, null), t).toEqual({ kind: "unknown" });
    }
    expect(allowsCountry(locationScope("Remote (US or LATAM time zones)", null), "AR")).toBe(true);
    expect(locationScope(null, ["US time zones"])).toEqual({ kind: "unknown" });
  });

  it("un código ISO explícito sigue valiendo aunque el texto hable de husos", () => {
    expect(locationScope("Remote - US time zones", ["US"])).toMatchObject({
      kind: "places",
      countries: ["US"],
    });
  });

  it("regiones", () => {
    expect(locationScope("Remoto (EMEA)", null)).toMatchObject({ regions: ["EMEA"] });
    expect(locationScope("Europe", null)).toMatchObject({ regions: ["EU"] });
    expect(locationScope("LATAM", null)).toMatchObject({ regions: ["LATAM"] });
    expect(locationScope("Americas", null)).toMatchObject({ regions: ["AMERICAS"] });
  });

  it("las entradas de countriesAllowed que no son ISO-2 se leen como texto", () => {
    expect(locationScope("Remote", ["LATINOAMÉRICA"])).toMatchObject({
      kind: "places",
      regions: ["LATAM"],
    });
    expect(locationScope(null, ["Argentina", "Chile"])).toMatchObject({
      countries: ["AR", "CL"],
    });
  });

  it("Bay Area y ciudades de EE.UU. son US, sin fail-open", () => {
    const bay = locationScope("Remote, Bay Area, CA", null);
    expect(bay).toMatchObject({ kind: "places", countries: ["US"] });
    expect(allowsCountry(bay, "AR")).toBe(false);
    expect(locationScope("Remote - San Francisco", null)).toMatchObject({ countries: ["US"] });
    expect(locationScope("SF Bay Area", null)).toMatchObject({ countries: ["US"] });
    expect(locationScope("Silicon Valley", null)).toMatchObject({ countries: ["US"] });
    expect(locationScope("Remote, California", null)).toMatchObject({ countries: ["US"] });
  });

  it("'CA' suelto sigue ambiguo (Canada o California)", () => {
    expect(locationScope("Remote, CA", null)).toEqual({ kind: "unknown" });
  });

  it("UK como código se normaliza a GB", () => {
    expect(locationScope(null, ["UK"])).toMatchObject({ countries: ["GB"] });
  });
});

describe("allowsCountry", () => {
  it("any y unknown: sí", () => {
    expect(allowsCountry({ kind: "any" }, "AR")).toBe(true);
    expect(allowsCountry({ kind: "unknown" }, "AR")).toBe(true);
  });

  it("país de la persona null: no descarta", () => {
    expect(allowsCountry(locationScope("Remote - US", null), null)).toBe(true);
  });

  it("solo un país o región que no la incluye: no", () => {
    for (const t of [
      "Remote - US",
      "US-Remote",
      "United States",
      "USA",
      "UK",
      "United Kingdom; London",
      "Canada",
      "EMEA",
      "Europe",
      "United Kingdom; Poland",
      "Remote, Canada; Remote, United States",
      "Remote - Colombia ; Remote - Costa Rica",
      "Berlin Office; Bosnia; Romania; Norway",
      "Remoto (USA)",
      "Remoto (EMEA)",
      "North America",
      "Central America",
      "Remote, New Mexico",
    ]) {
      expect(allows(t, null), t).toBe(false);
    }
  });

  it("incluye al país o a su región: sí", () => {
    for (const t of [
      "Argentina, Remote",
      "Remoto (EMEA, LATAM, Canada, USA)",
      "Remoto (LATAM)",
      "LATAM",
      "Latin America",
      "South America",
      "Americas",
      "Remote (US or LATAM)",
      "LATAM except Argentina",
      "Argentina / Brazil | Chile · Uruguay",
      "Remote (Worldwide)",
      "Global",
      "Remote",
      "New York, NY",
    ]) {
      expect(allows(t, null), t).toBe(true);
    }
  });

  it("New Mexico y Nuevo México son EE.UU.: no admiten a MX (JS-111)", () => {
    expect(locationScope("Remote - New Mexico, USA", null)).toMatchObject({ countries: ["US"] });
    expect(allows("Remote - New Mexico, USA", null, "MX")).toBe(false);
    expect(allows("Albuquerque, Nuevo México", null, "MX")).toBe(false);
    expect(allows("Ciudad de México", null, "MX")).toBe(true);
    expect(allows("Nuevo León, México", null, "MX")).toBe(true);
  });

  it("San Francisco ya es US (ronda 51-c): no admite a AR", () => {
    expect(allows("San Francisco, CA", null)).toBe(false);
  });

  it("LATAM y Americas contienen los países de la región", () => {
    for (const iso of ["AR", "BR", "MX", "CO", "UY"]) {
      expect(allows("LATAM", null, iso), iso).toBe(true);
      expect(allows("Americas", null, iso), iso).toBe(true);
    }
    expect(allows("Americas", null, "US")).toBe(true);
    expect(allows("LATAM", null, "US")).toBe(false);
  });

  it("países europeos para una persona europea", () => {
    expect(allows("Europe", null, "ES")).toBe(true);
    expect(allows("EMEA", null, "ES")).toBe(true);
    expect(allows("Remote - US", null, "US")).toBe(true);
  });

  it("countriesAllowed explícito", () => {
    expect(allows("Remote", ["US", "CA"])).toBe(false);
    expect(allows("Remote", ["US", "AR"])).toBe(true);
    expect(allows("Remote", ["LATINOAMÉRICA"])).toBe(true);
    expect(allows("Remote", ["*"])).toBe(true);
  });
});
