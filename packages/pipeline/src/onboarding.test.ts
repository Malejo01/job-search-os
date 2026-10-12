import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DISCIPLINES } from "./evaluation";
import { ROLE_KEYS } from "./skills/self-assessment";
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
    targetRole: "qa",
    country: "UY",
    countryOther: "",
    city: " Montevideo ",
    remoteOnly: "si",
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
        targetRole: "qa",
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
  it("targetRole: cada clave de ROLE_KEYS vale y 'otro' guarda null", () => {
    for (const role of ROLE_KEYS) {
      const r = parseOnboarding({ ...form, targetRole: role });
      expect(r.ok && r.value.targetRole).toBe(role);
    }
    const otro = parseOnboarding({ ...form, targetRole: "otro" });
    expect(otro.ok && otro.value.targetRole).toBeNull();
    const conEspacios = parseOnboarding({ ...form, targetRole: " fullstack " });
    expect(conEspacios.ok && conEspacios.value.targetRole).toBe("fullstack");
  });
  it("targetRole: ausente, vacío o desconocido reporta el campo", () => {
    const { targetRole: _omit, ...sinCampo } = form;
    void _omit;
    expect(parseOnboarding(sinCampo)).toEqual({ ok: false, field: "targetRole" });
    for (const v of ["", "OTRO", "Frontend", "devops", "__proto__"]) {
      expect(parseOnboarding({ ...form, targetRole: v })).toEqual({
        ok: false,
        field: "targetRole",
      });
    }
  });
  it("remoteOnly: 'no' es false; ausente u otro valor reporta el campo", () => {
    const no = parseOnboarding({ ...form, remoteOnly: "no" });
    expect(no.ok && no.value.remoteOnly).toBe(false);
    const { remoteOnly: _omit, ...sinCampo } = form;
    void _omit;
    expect(parseOnboarding(sinCampo)).toEqual({ ok: false, field: "remoteOnly" });
    for (const v of ["", "on", "SI", "true"]) {
      expect(parseOnboarding({ ...form, remoteOnly: v })).toEqual({
        ok: false,
        field: "remoteOnly",
      });
    }
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
  it("son neutros: todas las disciplinas, sin penalización de inglés, sin piso", () => {
    expect(DEFAULT_CRITERIA_RULES.allowed_disciplines).toEqual([...DISCIPLINES]);
    expect(DEFAULT_CRITERIA_RULES.english_fluent_penalty).toBe(0);
    expect(DEFAULT_CRITERIA_RULES.title_blocklist).toEqual(["director", "vp ", "chief", "head of"]);
    expect(DEFAULT_CRITERIA_RULES.salary_floor_usd_monthly).toBeNull();
  });
  it("en lo demás coinciden con criteria.example.json (mismas claves y valores)", () => {
    const path = resolve(__dirname, "../../db/seeds/criteria.example.json");
    const { _nota, ...example } = JSON.parse(readFileSync(path, "utf8"));
    void _nota;
    const changed = [
      "allowed_disciplines",
      "english_fluent_penalty",
      "title_blocklist",
      "salary_floor_usd_monthly",
    ];
    expect(Object.keys(DEFAULT_CRITERIA_RULES).sort()).toEqual(Object.keys(example).sort());
    const rest = (o: Record<string, unknown>) =>
      Object.fromEntries(Object.entries(o).filter(([k]) => !changed.includes(k)));
    expect(rest(DEFAULT_CRITERIA_RULES)).toEqual(rest(example));
  });
  it("sin piso en el formulario queda null", () => {
    expect(
      criteriaFromOnboarding({ salaryFloorUsd: null, maxWeeklyHours: null })
        .salary_floor_usd_monthly,
    ).toBeNull();
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
