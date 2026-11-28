import { describe, expect, it } from "vitest";
import {
  CAREER_OTHER_MAX,
  CAREER_OTHER_MIN,
  CAREER_OTHER_VALUE,
  needsCareerPrompt,
  parseCareerChoice,
  parseCareerOther,
} from "./career-choice";
import { parseOnboarding } from "./onboarding-parse";
import { BETA_LAUNCH_ROLE_KEYS } from "./skills/self-assessment";

describe("parseCareerOther", () => {
  it("recorta y junta los espacios", () => {
    expect(parseCareerOther("  Diseño   de   interiores ")).toEqual({
      ok: true,
      value: "Diseño de interiores",
    });
  });
  it("vacío o muy corto falla como corto", () => {
    expect(parseCareerOther("")).toEqual({ ok: false, reason: "corta" });
    expect(parseCareerOther("   ")).toEqual({ ok: false, reason: "corta" });
    expect(parseCareerOther("a".repeat(CAREER_OTHER_MIN - 1))).toEqual({
      ok: false,
      reason: "corta",
    });
  });
  it("el máximo es inclusivo", () => {
    expect(parseCareerOther("a".repeat(CAREER_OTHER_MAX)).ok).toBe(true);
    expect(parseCareerOther("a".repeat(CAREER_OTHER_MAX + 1))).toEqual({
      ok: false,
      reason: "larga",
    });
  });
  it("rechaza caracteres de control, enlaces y marcas de HTML", () => {
    for (const v of ["Derecho\u0000", "Derecho‮", "<b>Derecho</b>", "https://x.example", "a\nb"]) {
      expect(parseCareerOther(v), v).toEqual({ ok: false, reason: "caracteres" });
    }
  });
  it("acepta letras con tilde, números, guiones y puntos", () => {
    expect(parseCareerOther("Técnico/a en Higiene y Seguridad, nivel 2").ok).toBe(true);
    expect(parseCareerOther("Ing. en Alimentos").ok).toBe(true);
  });
  it("lo que no es texto falla cerrado", () => {
    expect(parseCareerOther(undefined)).toEqual({ ok: false, reason: "corta" });
    expect(parseCareerOther(42 as unknown as string)).toEqual({ ok: false, reason: "corta" });
  });
});

describe("parseCareerChoice", () => {
  it("una carrera de la beta", () => {
    expect(parseCareerChoice({ career: "abogacia", other: "" })).toEqual({
      ok: true,
      roles: ["abogacia"],
      other: null,
    });
  });
  it("las ocho carreras de la beta son válidas", () => {
    for (const key of BETA_LAUNCH_ROLE_KEYS) {
      expect(parseCareerChoice({ career: key, other: "" }).ok, key).toBe(true);
    }
  });
  it("una carrera de la beta ignora el texto de «Otra»", () => {
    expect(parseCareerChoice({ career: "comunicacion", other: "algo" })).toEqual({
      ok: true,
      roles: ["comunicacion"],
      other: null,
    });
  });
  it("«Otra» pide el texto", () => {
    expect(parseCareerChoice({ career: CAREER_OTHER_VALUE, other: "" })).toEqual({
      ok: false,
      field: "careerOther",
      reason: "corta",
    });
    expect(parseCareerChoice({ career: CAREER_OTHER_VALUE, other: "Arquitectura" })).toEqual({
      ok: true,
      roles: [],
      other: "Arquitectura",
    });
  });
  it("sin elegir o con una clave inventada falla en `career`", () => {
    expect(parseCareerChoice({ career: "", other: "" })).toEqual({ ok: false, field: "career" });
    expect(parseCareerChoice({ career: "inventada", other: "" })).toEqual({
      ok: false,
      field: "career",
    });
  });
  it("el prompt de una carrera que no es de la beta se rechaza (solo las ocho y «Otra»)", () => {
    expect(parseCareerChoice({ career: "qa", other: "" })).toEqual({ ok: false, field: "career" });
  });
});

describe("needsCareerPrompt", () => {
  const base = { targetRoles: [] as string[], careerOther: null, askedAt: null };
  it("cuenta sin carrera y sin haberla pedido: se pide", () => {
    expect(needsCareerPrompt(base)).toBe(true);
  });
  it("con carrera, no se pide", () => {
    expect(needsCareerPrompt({ ...base, targetRoles: ["fullstack"] })).toBe(false);
  });
  it("con «Otra» cargada, no se pide", () => {
    expect(needsCareerPrompt({ ...base, careerOther: "Arquitectura" })).toBe(false);
  });
  it("ya pedida una vez (la haya cargado o no), no se vuelve a pedir", () => {
    expect(needsCareerPrompt({ ...base, askedAt: new Date("2026-11-26T12:00:00Z") })).toBe(false);
  });
  it("sin dato del perfil (la consulta falló), no se pide: falla cerrado", () => {
    expect(needsCareerPrompt(null)).toBe(false);
  });
  it("una lista con claves desconocidas cuenta como sin carrera", () => {
    expect(needsCareerPrompt({ ...base, targetRoles: ["no_existe"] })).toBe(true);
  });
});

describe("parseOnboarding con «Otra»", () => {
  const form = {
    targetRoles: [] as string[],
    careerOther: "Arquitectura",
    country: "AR",
    city: "",
    acceptedModalities: ["remoto"],
    jobLanguage: "es",
    workAuthUs: "",
    workAuthEu: "",
    workAuthOther: [] as string[],
    englishCefr: "B1",
    yearsTotal: "3",
    salaryFloorUsd: "",
    maxWeeklyHours: "",
    summary: "Trabajo en proyectos de obra y documentación técnica desde hace varios años. ".repeat(
      4,
    ),
  };
  it("sin puestos pero con «Otra» válida, el alta pasa y guarda el texto", () => {
    const r = parseOnboarding(form);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.targetRoles).toEqual([]);
      expect(r.value.careerOther).toBe("Arquitectura");
    }
  });
  it("sin puestos y sin «Otra», sigue fallando en targetRoles", () => {
    expect(parseOnboarding({ ...form, careerOther: "" })).toEqual({
      ok: false,
      field: "targetRoles",
    });
  });
  it("«Otra» inválida falla en su campo", () => {
    expect(parseOnboarding({ ...form, careerOther: "<b>x</b>" })).toEqual({
      ok: false,
      field: "careerOther",
    });
  });
  it("con puestos elegidos, el texto de «Otra» se descarta", () => {
    const r = parseOnboarding({ ...form, targetRoles: ["abogacia"] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).not.toHaveProperty("careerOther");
  });
});
