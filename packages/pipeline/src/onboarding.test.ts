import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  criteriaFromOnboarding,
  DEFAULT_CRITERIA_RULES,
  isProfileComplete,
  isValidCountry,
  parseOnboarding,
} from "./onboarding";

const SUMMARY = "Desarrollo web con cinco años de experiencia en producto. ".repeat(2);

describe("isProfileComplete", () => {
  const ok = { locationCountry: "AR", profileSummary: SUMMARY, activeCriteriaCount: 1 };

  it("completo", () => expect(isProfileComplete(ok)).toBe(true));
  it("país XX (marcador del registro)", () =>
    expect(isProfileComplete({ ...ok, locationCountry: "XX" })).toBe(false));
  it("país vacío o no ISO-2", () => {
    expect(isProfileComplete({ ...ok, locationCountry: "" })).toBe(false);
    expect(isProfileComplete({ ...ok, locationCountry: "ARG" })).toBe(false);
    expect(isProfileComplete({ ...ok, locationCountry: "ar" })).toBe(false);
  });
  it("resumen vacío, nulo o demasiado corto", () => {
    expect(isProfileComplete({ ...ok, profileSummary: "" })).toBe(false);
    expect(isProfileComplete({ ...ok, profileSummary: null })).toBe(false);
    expect(isProfileComplete({ ...ok, profileSummary: "   corto   " })).toBe(false);
  });
  it("sin criterios activos", () =>
    expect(isProfileComplete({ ...ok, activeCriteriaCount: 0 })).toBe(false));
});

describe("isValidCountry", () => {
  it("rechaza XX y formatos raros", () => {
    expect(isValidCountry("XX")).toBe(false);
    expect(isValidCountry(null)).toBe(false);
    expect(isValidCountry("A1")).toBe(false);
    expect(isValidCountry("UY")).toBe(true);
  });
});

describe("parseOnboarding", () => {
  const form = {
    country: "UY",
    countryOther: "",
    city: " Montevideo ",
    remoteOnly: "on",
    workAuthUs: "",
    workAuthEu: "on",
    workAuthOther: "CA, , MX",
    englishCefr: "B2",
    yearsTotal: "4.5",
    salaryFloorUsd: "2500",
    maxWeeklyHours: "",
    summary: SUMMARY,
  };

  it("formulario válido", () => {
    const r = parseOnboarding(form);
    expect(r).toEqual({
      ok: true,
      value: {
        locationCountry: "UY",
        locationCity: "Montevideo",
        remoteOnly: true,
        workAuth: { us: false, eu: true, other: ["CA", "MX"] },
        englishCefr: "B2",
        yearsTotal: 4.5,
        salaryFloorUsd: 2500,
        maxWeeklyHours: null,
        profileSummary: SUMMARY.trim(),
      },
    });
  });
  it("país 'otro' usa el código escrito", () => {
    const r = parseOnboarding({ ...form, country: "OTRO", countryOther: "pt" });
    expect(r.ok && r.value.locationCountry).toBe("PT");
    expect(parseOnboarding({ ...form, country: "OTRO", countryOther: "XX" })).toEqual({
      ok: false,
      field: "countryOther",
    });
  });
  it("resumen corto, inglés inválido y años faltantes reportan el campo", () => {
    expect(parseOnboarding({ ...form, summary: "corto" })).toEqual({ ok: false, field: "summary" });
    expect(parseOnboarding({ ...form, englishCefr: "D9" })).toEqual({
      ok: false,
      field: "englishCefr",
    });
    expect(parseOnboarding({ ...form, yearsTotal: "" })).toEqual({
      ok: false,
      field: "yearsTotal",
    });
  });
  it("piso salarial negativo o decimal", () => {
    expect(parseOnboarding({ ...form, salaryFloorUsd: "-1" }).ok).toBe(false);
    expect(parseOnboarding({ ...form, salaryFloorUsd: "10.5" }).ok).toBe(false);
  });
});

describe("criterios por defecto", () => {
  it("espejo de criteria.example.json", () => {
    const path = resolve(__dirname, "../../db/seeds/criteria.example.json");
    const { _nota, ...example } = JSON.parse(readFileSync(path, "utf8"));
    void _nota;
    expect(DEFAULT_CRITERIA_RULES).toEqual(example);
  });
  it("aplica piso y horas del formulario solo si vienen", () => {
    expect(criteriaFromOnboarding({ salaryFloorUsd: 2000, maxWeeklyHours: 30 })).toMatchObject({
      salary_floor_usd_monthly: 2000,
      max_weekly_hours: 30,
    });
    expect(criteriaFromOnboarding({ salaryFloorUsd: null, maxWeeklyHours: null })).toEqual(
      DEFAULT_CRITERIA_RULES,
    );
  });
});
