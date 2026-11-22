import { describe, expect, it } from "vitest";
import { jobTransparency, transparencyLevel, type TransparencyInput } from "./job-transparency";

const full: TransparencyInput = {
  title: "Analista Senior de Datos",
  company: "Empresa A",
  jdText: [
    "Sobre el puesto",
    "Responsabilidades: armar reportes semanales y mantener tableros.",
    "Requisitos: SQL y experiencia con herramientas de BI.",
  ].join("\n"),
  locationRaw: "Ciudad A, País A",
  countriesAllowed: null,
  modality: "remoto",
  salaryMinUsd: 11,
  salaryMaxUsd: 22,
  yearsRequired: 3,
};

const empty: TransparencyInput = {
  title: "",
  company: null,
  jdText: null,
  locationRaw: null,
  countriesAllowed: null,
  modality: null,
  salaryMinUsd: null,
  salaryMaxUsd: null,
  yearsRequired: null,
};

describe("transparencyLevel", () => {
  it("traduce el puntaje a un nivel", () => {
    expect(transparencyLevel(10)).toBe("clear");
    expect(transparencyLevel(7.5)).toBe("clear");
    expect(transparencyLevel(7)).toBe("partial");
    expect(transparencyLevel(4.5)).toBe("partial");
    expect(transparencyLevel(4)).toBe("opaque");
    expect(transparencyLevel(0)).toBe("opaque");
  });
});

describe("jobTransparency", () => {
  it("un aviso completo da 10, nivel claro y nada que falte", () => {
    const r = jobTransparency(full);
    expect(r.score).toBe(10);
    expect(r.level).toBe("clear");
    expect(r.missing).toEqual([]);
  });

  it("un aviso vacío da 0, opaco, y le falta todo en orden", () => {
    const r = jobTransparency(empty);
    expect(r.score).toBe(0);
    expect(r.level).toBe("opaque");
    expect(r.missing).toEqual([
      "salary",
      "modality",
      "company",
      "seniority",
      "location",
      "tasks",
      "requirements",
    ]);
  });

  it("sin sueldo baja el puntaje y lo lista", () => {
    const r = jobTransparency({ ...full, salaryMinUsd: null, salaryMaxUsd: null });
    expect(r.missing).toEqual(["salary"]);
    expect(r.score).toBeLessThan(10);
    expect(r.score).toBeGreaterThanOrEqual(7.5);
  });

  it("modalidad desconocida cuenta como faltante", () => {
    expect(jobTransparency({ ...full, modality: "desconocida" }).missing).toEqual(["modality"]);
  });

  it("empresa confidencial o vacía cuenta como faltante", () => {
    expect(jobTransparency({ ...full, company: "Empresa confidencial" }).missing).toEqual([
      "company",
    ]);
    expect(jobTransparency({ ...full, company: "   " }).missing).toEqual(["company"]);
  });

  it("seniority sale de los años pedidos o del título", () => {
    expect(
      jobTransparency({ ...full, title: "Analista de Datos", yearsRequired: 2 }).missing,
    ).toEqual([]);
    expect(
      jobTransparency({ ...full, title: "Analista Junior", yearsRequired: null }).missing,
    ).toEqual([]);
    expect(
      jobTransparency({ ...full, title: "Analista de Datos", yearsRequired: null }).missing,
    ).toEqual(["seniority"]);
  });

  it("ubicación sale del texto o de los países permitidos", () => {
    expect(
      jobTransparency({ ...full, locationRaw: null, countriesAllowed: ["AR"] }).missing,
    ).toEqual([]);
    expect(jobTransparency({ ...full, locationRaw: null, countriesAllowed: [] }).missing).toEqual([
      "location",
    ]);
  });

  it("tareas y requisitos se detectan en el texto, en español e inglés", () => {
    const en = "Responsibilities: build dashboards.\nQualifications: SQL.";
    expect(jobTransparency({ ...full, jdText: en }).missing).toEqual([]);
    expect(jobTransparency({ ...full, jdText: "Somos un equipo joven." }).missing).toEqual([
      "tasks",
      "requirements",
    ]);
    expect(jobTransparency({ ...full, jdText: "Requisitos: SQL." }).missing).toEqual(["tasks"]);
  });

  it("el puntaje va en pasos de 0,5 entre 0 y 10", () => {
    for (const salary of [null, 1]) {
      for (const company of [null, "Empresa A"]) {
        const r = jobTransparency({
          ...empty,
          company,
          salaryMaxUsd: salary,
          locationRaw: "Ciudad A",
        });
        expect(r.score).toBeGreaterThanOrEqual(0);
        expect(r.score).toBeLessThanOrEqual(10);
        expect(r.score * 2).toBe(Math.round(r.score * 2));
      }
    }
  });

  it("un texto de afuera de 2 MB se procesa en menos de 100 ms", () => {
    const filler = "lorem ipsum dolor sit amet ".repeat(80_000).slice(0, 2 * 1024 * 1024);
    for (const jdText of [filler, `${filler} Responsabilidades: x. Requisitos: y.`]) {
      const t0 = performance.now();
      jobTransparency({ ...full, jdText });
      expect(performance.now() - t0).toBeLessThan(100);
    }
  });

  it("un texto de afuera patológico no cuelga la función", () => {
    const hostile = `${"Requisitos".slice(0, 5)} `.repeat(400_000);
    const t0 = performance.now();
    jobTransparency({ ...full, jdText: hostile });
    expect(performance.now() - t0).toBeLessThan(100);
  });
});
