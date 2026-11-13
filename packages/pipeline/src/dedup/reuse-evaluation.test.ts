import { describe, expect, it } from "vitest";
import {
  reuseJobFingerprint,
  shouldReuseEvaluation,
  type ReuseCurrent,
  type ReusePrev,
} from "./reuse-evaluation";

const EVALUATED_AT = new Date("2026-11-10T12:00:00.000Z");
const JOB = {
  title: "Ingeniera de Datos",
  companyRaw: "Empresa A",
  locationRaw: "Remoto, LATAM",
  countriesAllowed: ["AR", "UY"],
  modality: "remoto",
  contractType: null,
  salaryMinUsd: 2000,
  salaryMaxUsd: 3000,
  salaryPeriod: "mensual",
  salaryNote: null,
  weeklyHours: 40,
  candidatesCount: null,
  badges: null,
  postedAt: null,
  matchedRole: "data_engineer",
  jdText: "Texto del aviso.",
};

const prev: ReusePrev = {
  jdHash: "abc123",
  promptVersion: "evaluate_job@v1.4.0",
  criteriaVersion: 3,
  evaluatedAt: EVALUATED_AT,
  hadFullJd: true,
  jobFingerprint: reuseJobFingerprint(JOB),
};
const current: ReuseCurrent = {
  jdHash: "abc123",
  promptVersion: "evaluate_job@v1.4.0",
  criteriaVersion: 3,
  profileUpdatedAt: new Date("2026-11-01T00:00:00.000Z"),
  jobFingerprint: reuseJobFingerprint(JOB),
};

describe("shouldReuseEvaluation (R7-2)", () => {
  it("reutiliza con mismo hash, perfil y criterios sin cambios y mismo prompt", () => {
    expect(shouldReuseEvaluation({ prev, current })).toEqual({ reuse: true });
  });

  it("reevalúa si el hash cambió, falta o está vacío", () => {
    expect(shouldReuseEvaluation({ prev, current: { ...current, jdHash: "otro" } })).toEqual({
      reuse: false,
      reason: "jd_distinta",
    });
    expect(
      shouldReuseEvaluation({
        prev: { ...prev, jdHash: null },
        current: { ...current, jdHash: null },
      }),
    ).toEqual({
      reuse: false,
      reason: "sin_hash",
    });
    expect(
      shouldReuseEvaluation({ prev: { ...prev, jdHash: "" }, current: { ...current, jdHash: "" } }),
    ).toEqual({
      reuse: false,
      reason: "sin_hash",
    });
  });

  it("reevalúa si cambió la versión de los criterios", () => {
    expect(shouldReuseEvaluation({ prev, current: { ...current, criteriaVersion: 4 } })).toEqual({
      reuse: false,
      reason: "criterios_cambiaron",
    });
  });

  it("reevalúa si el perfil se tocó después de la evaluación previa (también en el mismo instante o después)", () => {
    expect(
      shouldReuseEvaluation({
        prev,
        current: { ...current, profileUpdatedAt: new Date(EVALUATED_AT.getTime() + 1) },
      }),
    ).toEqual({ reuse: false, reason: "perfil_cambio" });
    // En el mismo instante no se puede asegurar el orden: ante la duda, se reevalúa
    expect(
      shouldReuseEvaluation({ prev, current: { ...current, profileUpdatedAt: EVALUATED_AT } }),
    ).toEqual({ reuse: false, reason: "perfil_cambio" });
  });

  it("reevalúa si cambió la versión del prompt", () => {
    expect(
      shouldReuseEvaluation({
        prev,
        current: { ...current, promptVersion: "evaluate_job@v1.4.1" },
      }),
    ).toEqual({ reuse: false, reason: "prompt_distinto" });
  });

  it("reevalúa si la evaluación previa no tenía la JD completa", () => {
    expect(shouldReuseEvaluation({ prev: { ...prev, hadFullJd: false }, current })).toEqual({
      reuse: false,
      reason: "previa_sin_jd",
    });
  });

  it("reevalúa si cambió algún dato del aviso que entra al prompt (título, sueldo, país...)", () => {
    for (const patch of [
      { title: "Ingeniera Senior de Datos" },
      { salaryMinUsd: 1000 },
      { countriesAllowed: ["AR"] },
      { locationRaw: "Buenos Aires" },
      { modality: "hibrido" },
      { companyRaw: "Empresa B" },
    ]) {
      const c = { ...current, jobFingerprint: reuseJobFingerprint({ ...JOB, ...patch }) };
      expect(shouldReuseEvaluation({ prev, current: c })).toEqual({
        reuse: false,
        reason: "aviso_distinto",
      });
    }
  });

  it("falta de datos de la evaluación previa o fechas inválidas: reevalúa", () => {
    expect(
      shouldReuseEvaluation({ prev: { ...prev, evaluatedAt: new Date("x") }, current }),
    ).toEqual({ reuse: false, reason: "fecha_invalida" });
    expect(
      shouldReuseEvaluation({ prev, current: { ...current, profileUpdatedAt: new Date("x") } }),
    ).toEqual({ reuse: false, reason: "fecha_invalida" });
  });
});

describe("reuseJobFingerprint", () => {
  it("es estable ante el orden de países y espacios sobrantes, null y vacío son lo mismo", () => {
    const a = reuseJobFingerprint({
      ...JOB,
      countriesAllowed: ["UY", "AR"],
      title: " Ingeniera de Datos ",
    });
    expect(a).toBe(reuseJobFingerprint(JOB));
    expect(reuseJobFingerprint({ ...JOB, salaryNote: "" })).toBe(reuseJobFingerprint(JOB));
  });

  it("countriesAllowed null (desconocido) no es lo mismo que lista vacía", () => {
    expect(reuseJobFingerprint({ ...JOB, countriesAllowed: null })).not.toBe(
      reuseJobFingerprint({ ...JOB, countriesAllowed: [] }),
    );
  });

  it("no depende del texto de la JD (eso lo cubre el hash)", () => {
    expect(reuseJobFingerprint({ ...JOB, jdText: "otro" })).toBe(reuseJobFingerprint(JOB));
  });
});
