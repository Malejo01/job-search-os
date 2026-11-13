import { describe, expect, it } from "vitest";
import {
  parseReuseInputs,
  reuseInputsToJson,
  reuseJobFingerprint,
  shouldReuseEvaluation,
  type ReuseCurrent,
  type ReuseInputs,
  type ReusePrev,
} from "./reuse-evaluation";

const PROFILE_AT = new Date("2026-11-01T00:00:00.000Z");
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

const inputs: ReuseInputs = {
  jdHash: "abc123",
  profileUpdatedAt: PROFILE_AT.toISOString(),
  criteriaVersion: 3,
  jobFingerprint: reuseJobFingerprint(JOB),
};
const prev: ReusePrev = { inputs, promptVersion: "evaluate_job@v1.4.0" };
const current: ReuseCurrent = {
  jdHash: "abc123",
  promptVersion: "evaluate_job@v1.4.0",
  criteriaVersion: 3,
  profileUpdatedAt: PROFILE_AT,
  jobFingerprint: reuseJobFingerprint(JOB),
};
const no = (reason: string) => ({ reuse: false, reason });

describe("shouldReuseEvaluation (R7-2)", () => {
  it("reutiliza con mismo hash, perfil y criterios sin cambios y mismo prompt", () => {
    expect(shouldReuseEvaluation({ prev, current })).toEqual({ reuse: true });
  });

  it("evaluación sin inputs (todas las anteriores a R7-2): no se reutiliza nunca", () => {
    expect(shouldReuseEvaluation({ prev: { ...prev, inputs: null }, current })).toEqual(
      no("sin_inputs"),
    );
  });

  it("JD cambiada después de evaluar: el hash de los inputs no coincide con el del aviso nuevo", () => {
    expect(shouldReuseEvaluation({ prev, current: { ...current, jdHash: "jd-v2" } })).toEqual(
      no("jd_distinta"),
    );
  });

  it("hash ausente o vacío: reevalúa", () => {
    expect(shouldReuseEvaluation({ prev, current: { ...current, jdHash: null } })).toEqual(
      no("sin_hash"),
    );
    expect(
      shouldReuseEvaluation({
        prev: { ...prev, inputs: { ...inputs, jdHash: "" } },
        current: { ...current, jdHash: "" },
      }),
    ).toEqual(no("sin_hash"));
  });

  it("perfil editado durante la llamada al modelo (o después): el updated_at de hoy ya no es el leído antes", () => {
    for (const ms of [1, 5_000, -1]) {
      expect(
        shouldReuseEvaluation({
          prev,
          current: { ...current, profileUpdatedAt: new Date(PROFILE_AT.getTime() + ms) },
        }),
      ).toEqual(no("perfil_cambio"));
    }
  });

  it("cambió la versión de los criterios", () => {
    expect(shouldReuseEvaluation({ prev, current: { ...current, criteriaVersion: 4 } })).toEqual(
      no("criterios_cambiaron"),
    );
  });

  it("cambió la versión del prompt", () => {
    expect(
      shouldReuseEvaluation({
        prev,
        current: { ...current, promptVersion: "evaluate_job@v1.4.1" },
      }),
    ).toEqual(no("prompt_distinto"));
  });

  it("cambió algún dato del aviso que entra al prompt (título, sueldo, país...)", () => {
    for (const patch of [
      { title: "Ingeniera Senior de Datos" },
      { salaryMinUsd: 1000 },
      { countriesAllowed: ["AR"] },
      { locationRaw: "Buenos Aires" },
      { modality: "hibrido" },
      { companyRaw: "Empresa B" },
    ]) {
      const c = { ...current, jobFingerprint: reuseJobFingerprint({ ...JOB, ...patch }) };
      expect(shouldReuseEvaluation({ prev, current: c })).toEqual(no("aviso_distinto"));
    }
  });

  it("fechas inválidas: reevalúa", () => {
    expect(
      shouldReuseEvaluation({
        prev: { ...prev, inputs: { ...inputs, profileUpdatedAt: "x" } },
        current,
      }),
    ).toEqual(no("fecha_invalida"));
    expect(
      shouldReuseEvaluation({ prev, current: { ...current, profileUpdatedAt: new Date("x") } }),
    ).toEqual(no("fecha_invalida"));
  });

  it("encadena: una evaluación reutilizada que copia los inputs de la original sigue siendo reutilizable", () => {
    const copied = parseReuseInputs({ inputs: reuseInputsToJson(inputs) });
    expect(shouldReuseEvaluation({ prev: { ...prev, inputs: copied }, current })).toEqual({
      reuse: true,
    });
  });
});

describe("parseReuseInputs / reuseInputsToJson", () => {
  it("ida y vuelta", () => {
    expect(parseReuseInputs({ inputs: reuseInputsToJson(inputs) })).toEqual(inputs);
  });

  it("decision sin inputs o con forma inesperada devuelve null", () => {
    expect(parseReuseInputs(null)).toBeNull();
    expect(parseReuseInputs({})).toBeNull();
    expect(parseReuseInputs({ inputs: "x" })).toBeNull();
    expect(parseReuseInputs({ inputs: { jd_hash: "a" } })).toBeNull();
    expect(
      parseReuseInputs({ inputs: { ...reuseInputsToJson(inputs), criteria_version: "3" } }),
    ).toBeNull();
    expect(parseReuseInputs({ inputs: { ...reuseInputsToJson(inputs), jd_hash: "" } })).toBeNull();
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
