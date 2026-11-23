import { describe, expect, it } from "vitest";
import {
  COACH_UNIT_TASKS,
  CV_DIAGNOSIS_UNIT_TASKS,
  INTERVIEW_UNIT_TASKS,
  MIN_PEOPLE_FOR_PERCENTILES,
  OFFER_UNIT_TASKS,
  computeUnitCosts,
  unitPercentile,
  type UnitCostInput,
} from "./unit-cost";

const base: UnitCostInput = {
  tasks: [
    { task: "evaluate_job", spendUsd: 1.0, calls: 12, okCalls: 10 },
    { task: "extract_skills", spendUsd: 0.2, calls: 10, okCalls: 10 },
    { task: "interview_questions", spendUsd: 0.04, calls: 4, okCalls: 4 },
    { task: "interview_feedback", spendUsd: 0.16, calls: 20, okCalls: 20 },
    { task: "cv_coach_turn", spendUsd: 0.3, calls: 15, okCalls: 15 },
    { task: "cv_write", spendUsd: 0.1, calls: 2, okCalls: 2 },
    { task: "cv_review", spendUsd: 0.09, calls: 3, okCalls: 3 },
    { task: "assistant_chat", spendUsd: 0.5, calls: 9, okCalls: 9 },
  ],
  coachChats: 2,
  personSpendUsd: [0.1, 0.2, 0.3, 0.4, 1.0],
};

describe("unitPercentile", () => {
  it("interpola entre vecinos y no depende del orden de entrada", () => {
    expect(unitPercentile([4, 1, 3, 2], 0.5)).toBeCloseTo(2.5, 10);
    expect(unitPercentile([0.1, 0.2, 0.3, 0.4, 1.0], 0.9)).toBeCloseTo(0.76, 10);
  });
  it("un solo valor es ese valor; lista vacía es null", () => {
    expect(unitPercentile([7], 0.9)).toBe(7);
    expect(unitPercentile([], 0.5)).toBeNull();
  });
});

describe("computeUnitCosts", () => {
  it("calcula el costo por unidad con las tareas de cada una", () => {
    const r = computeUnitCosts(base);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const v = r.value;
    // oferta: (1,0 + 0,2) / 10 evaluaciones logradas
    expect(v.offer).toEqual({ units: 10, spendUsd: 1.2, costPerUnitUsd: 0.12 });
    // Interview: (0,04 + 0,16) / 4 simulaciones (una pregunta-set por simulación)
    expect(v.interview.units).toBe(4);
    expect(v.interview.costPerUnitUsd).toBeCloseTo(0.05, 10);
    // coach: (0,3 + 0,1) / 2 charlas
    expect(v.coach.units).toBe(2);
    expect(v.coach.costPerUnitUsd).toBeCloseTo(0.2, 10);
    // CV: 0,09 / 3 diagnósticos
    expect(v.cvDiagnosis.costPerUnitUsd).toBeCloseTo(0.03, 10);
  });

  it("persona activa: p50 y p90 con al menos 3 personas", () => {
    const r = computeUnitCosts(base);
    if (!r.ok) throw new Error("debía ser ok");
    expect(r.value.person).toEqual({
      kind: "ok",
      people: 5,
      p50Usd: 0.3,
      p90Usd: expect.closeTo(0.76, 10),
    });
  });

  it("con menos de 3 personas no da percentiles: «menos de 3»", () => {
    expect(MIN_PEOPLE_FOR_PERCENTILES).toBe(3);
    const r = computeUnitCosts({ ...base, personSpendUsd: [0.5, 0.7] });
    if (!r.ok) throw new Error("debía ser ok");
    expect(r.value.person).toEqual({ kind: "menos_de_3", people: 2 });
  });

  it("sin personas es «sin datos»", () => {
    const r = computeUnitCosts({ ...base, personSpendUsd: [] });
    if (!r.ok) throw new Error("debía ser ok");
    expect(r.value.person).toEqual({ kind: "sin_datos" });
  });

  it("unidad sin conteo es null, nunca división por cero", () => {
    const r = computeUnitCosts({
      tasks: [{ task: "evaluate_job", spendUsd: 0.5, calls: 3, okCalls: 0 }],
      coachChats: 0,
      personSpendUsd: [],
    });
    if (!r.ok) throw new Error("debía ser ok");
    expect(r.value.offer).toEqual({ units: 0, spendUsd: 0.5, costPerUnitUsd: null });
    expect(r.value.interview).toEqual({ units: 0, spendUsd: 0, costPerUnitUsd: null });
    expect(r.value.coach.costPerUnitUsd).toBeNull();
    expect(r.value.cvDiagnosis.costPerUnitUsd).toBeNull();
  });

  it("las filas repetidas de una tarea se suman y las tareas ajenas no cuentan", () => {
    const r = computeUnitCosts({
      tasks: [
        { task: "cv_review", spendUsd: 0.1, calls: 1, okCalls: 1 },
        { task: "cv_review", spendUsd: 0.2, calls: 2, okCalls: 2 },
        { task: "assistant_chat", spendUsd: 9, calls: 9, okCalls: 9 },
      ],
      coachChats: 0,
      personSpendUsd: [],
    });
    if (!r.ok) throw new Error("debía ser ok");
    expect(r.value.cvDiagnosis.units).toBe(3);
    expect(r.value.cvDiagnosis.spendUsd).toBeCloseTo(0.3, 10);
    expect(r.value.offer.spendUsd).toBe(0);
  });

  it("una tarea no está en dos unidades (sin doble conteo)", () => {
    const all = [
      ...OFFER_UNIT_TASKS,
      ...INTERVIEW_UNIT_TASKS,
      ...COACH_UNIT_TASKS,
      ...CV_DIAGNOSIS_UNIT_TASKS,
    ];
    expect(new Set(all).size).toBe(all.length);
  });

  it("falla cerrado con números inválidos", () => {
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        computeUnitCosts({
          ...base,
          tasks: [{ task: "evaluate_job", spendUsd: bad, calls: 1, okCalls: 1 }],
        }).ok,
      ).toBe(false);
      expect(computeUnitCosts({ ...base, personSpendUsd: [0.1, bad, 0.2] }).ok).toBe(false);
    }
    expect(computeUnitCosts({ ...base, coachChats: -1 }).ok).toBe(false);
    expect(computeUnitCosts({ ...base, coachChats: 1.5 }).ok).toBe(false);
    expect(
      computeUnitCosts({
        ...base,
        tasks: [{ task: "cv_review", spendUsd: 1, calls: 1, okCalls: 2 }],
      }).ok,
    ).toBe(false);
  });
});
