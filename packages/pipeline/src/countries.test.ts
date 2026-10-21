import { describe, expect, it } from "vitest";
import { ISO_COUNTRY_CODES, isIsoCountry } from "./countries";

describe("ISO_COUNTRY_CODES", () => {
  it("tiene los países asignados, sin repetir y en mayúsculas", () => {
    expect(ISO_COUNTRY_CODES.length).toBeGreaterThan(240);
    expect(new Set(ISO_COUNTRY_CODES).size).toBe(ISO_COUNTRY_CODES.length);
    for (const c of ISO_COUNTRY_CODES) expect(c).toMatch(/^[A-Z]{2}$/);
    for (const c of ["AR", "CA", "MX", "DE"]) expect(ISO_COUNTRY_CODES).toContain(c);
    expect(ISO_COUNTRY_CODES).not.toContain("XX");
  });
  it("todos tienen nombre en español", () => {
    const names = new Intl.DisplayNames(["es"], { type: "region" });
    for (const c of ISO_COUNTRY_CODES) expect(names.of(c)).not.toBe(c);
  });
});

describe("isIsoCountry", () => {
  it("valida solo códigos asignados en mayúsculas", () => {
    expect(isIsoCountry("CA")).toBe(true);
    expect(isIsoCountry("XX")).toBe(false);
    expect(isIsoCountry("ca")).toBe(false);
    expect(isIsoCountry("CAN")).toBe(false);
    expect(isIsoCountry(null)).toBe(false);
    expect(isIsoCountry(undefined)).toBe(false);
  });
});
