import { describe, expect, it } from "vitest";
import {
  REEVALUATION_MAX_USD_LIMIT,
  decideNextReevaluation,
  estimateReevaluationUsd,
  parseReevaluationMaxUsd,
  perCallReevaluationUsd,
  selectReevaluationCandidates,
  type ReevaluationRow,
} from "./plan";

const NEW = "evaluate_job@v1.5.0";
const row = (n: number, over: Partial<ReevaluationRow> = {}): ReevaluationRow => ({
  jobId: `job-${n}`,
  userId: `user-${n % 2}`,
  status: "evaluada",
  lastPromptVersion: "evaluate_job@v1.4.0",
  ...over,
});

describe("selectReevaluationCandidates", () => {
  it("toma las abiertas (evaluada) cuya última evaluación no es de la versión nueva", () => {
    const r = selectReevaluationCandidates(
      [
        row(1),
        row(2, { lastPromptVersion: NEW }),
        row(3, { status: "descartada" }),
        row(4, { status: "cerrada" }),
        row(5, { status: "aplicada" }),
        row(6, { lastPromptVersion: null }),
      ],
      { promptVersion: NEW, done: new Set() },
    );
    expect(r.todo.map((x) => x.jobId)).toEqual(["job-1"]);
    expect(r.upToDate.map((x) => x.jobId)).toEqual(["job-2"]);
    expect(r.notEligible.map((x) => x.jobId)).toEqual(["job-3", "job-4", "job-5", "job-6"]);
  });

  it("retomar: lo que ya hizo la corrida no se repite", () => {
    const r = selectReevaluationCandidates([row(1), row(2), row(3)], {
      promptVersion: NEW,
      done: new Set(["job-1", "job-3"]),
    });
    expect(r.todo.map((x) => x.jobId)).toEqual(["job-2"]);
    expect(r.alreadyDone.map((x) => x.jobId)).toEqual(["job-1", "job-3"]);
  });

  it("una oferta evaluada nunca (sin versión) no entra: no hay nada que comparar ni volver atrás", () => {
    const r = selectReevaluationCandidates([row(1, { lastPromptVersion: null })], {
      promptVersion: NEW,
      done: new Set(),
    });
    expect(r.todo).toEqual([]);
  });

  it("con un límite, toma solo las primeras N (en el orden dado)", () => {
    const r = selectReevaluationCandidates([row(1), row(2), row(3)], {
      promptVersion: NEW,
      done: new Set(),
      limit: 2,
    });
    expect(r.todo.map((x) => x.jobId)).toEqual(["job-1", "job-2"]);
    expect(r.deferred.map((x) => x.jobId)).toEqual(["job-3"]);
  });
});

describe("estimación y tope", () => {
  it("el estimado por llamada sale del ruteo y es conservador (el prompt nuevo trae la ficha)", () => {
    const perCall = perCallReevaluationUsd({ inUsd: 2, outUsd: 10 });
    expect(perCall).toBeGreaterThan((1950 * 2 + 430 * 10) / 1e6);
    expect(perCall).toBeLessThan(0.05);
    expect(perCallReevaluationUsd(null)).toBeNull();
  });

  it("estima el total de la corrida", () => {
    expect(estimateReevaluationUsd(10, 0.012)).toBeCloseTo(0.12, 6);
    expect(estimateReevaluationUsd(10, null)).toBeNull();
  });

  it("frena cuando lo gastado más lo que cuesta la próxima pasa el tope", () => {
    expect(decideNextReevaluation({ spentUsd: 0.5, maxUsd: 1, estimateUsd: 0.1 })).toEqual({
      ok: true,
    });
    expect(decideNextReevaluation({ spentUsd: 0.95, maxUsd: 1, estimateUsd: 0.1 })).toEqual({
      ok: false,
      reason: "cap",
    });
  });

  it("sin estimado conocido, frena cuando ya se gastó el tope (no se asume gratis a ciegas)", () => {
    expect(decideNextReevaluation({ spentUsd: 0.4, maxUsd: 1, estimateUsd: null }).ok).toBe(true);
    expect(decideNextReevaluation({ spentUsd: 1, maxUsd: 1, estimateUsd: null }).ok).toBe(false);
  });

  it("un número ilegible frena", () => {
    expect(decideNextReevaluation({ spentUsd: Number.NaN, maxUsd: 1, estimateUsd: 0.1 }).ok).toBe(
      false,
    );
  });
});

describe("parseReevaluationMaxUsd (el tope es obligatorio)", () => {
  it("sin tope, o con un tope que no es un número positivo, no corre", () => {
    expect(parseReevaluationMaxUsd(undefined)).toEqual({ ok: false, error: "falta" });
    expect(parseReevaluationMaxUsd("")).toEqual({ ok: false, error: "falta" });
    for (const bad of ["0", "-1", "abc", "NaN", "Infinity", "1e999"]) {
      expect(parseReevaluationMaxUsd(bad), bad).toEqual({ ok: false, error: "invalido" });
    }
  });

  it("acepta un monto razonable y rechaza uno absurdo (un cero de más)", () => {
    expect(parseReevaluationMaxUsd("2.5")).toEqual({ ok: true, value: 2.5 });
    expect(parseReevaluationMaxUsd(String(REEVALUATION_MAX_USD_LIMIT))).toEqual({
      ok: true,
      value: REEVALUATION_MAX_USD_LIMIT,
    });
    expect(parseReevaluationMaxUsd(String(REEVALUATION_MAX_USD_LIMIT + 1))).toEqual({
      ok: false,
      error: "invalido",
    });
  });
});
