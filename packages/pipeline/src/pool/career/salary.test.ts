import { describe, expect, it } from "vitest";
import { monthlySalaryPoint, MIN_SALARY_SAMPLE, percentile, summarizeSalaries } from "./salary";

describe("monthlySalaryPoint", () => {
  it("promedia mínimo y máximo", () => {
    expect(monthlySalaryPoint(2000, 3000, "mensual")).toBe(2500);
  });

  it("usa el que haya", () => {
    expect(monthlySalaryPoint(2000, null, "mensual")).toBe(2000);
    expect(monthlySalaryPoint(null, 3000, "mensual")).toBe(3000);
  });

  it("sin montos: null", () => {
    expect(monthlySalaryPoint(null, null, "mensual")).toBeNull();
  });

  it("período desconocido o ausente: null", () => {
    expect(monthlySalaryPoint(2000, 3000, null)).toBeNull();
    expect(monthlySalaryPoint(2000, 3000, "semanal")).toBeNull();
  });

  it("lleva anual y hora a mensual", () => {
    expect(monthlySalaryPoint(48000, 72000, "anual")).toBe(5000);
    expect(monthlySalaryPoint(20, 30, "hora")).toBe(4000);
  });

  it("regla A: un anual con monto crudo menor a 15000 se descarta", () => {
    expect(monthlySalaryPoint(12000, 12000, "anual")).toBeNull();
    // se mira el promedio crudo (14000)
    expect(monthlySalaryPoint(10000, 18000, "anual")).toBeNull();
    expect(monthlySalaryPoint(14999, 14999, "anual")).toBeNull();
    expect(monthlySalaryPoint(15000, 15000, "anual")).toBe(1250);
    // el mismo monto mensual no es sospechoso
    expect(monthlySalaryPoint(12000, 12000, "mensual")).toBe(12000);
  });

  it("descarta fuera de los límites", () => {
    expect(monthlySalaryPoint(60000, 80000, "mensual")).toBeNull();
    expect(monthlySalaryPoint(50, 100, "mensual")).toBeNull();
    expect(monthlySalaryPoint(200, 200, "mensual")).toBe(200);
    expect(monthlySalaryPoint(40000, 40000, "mensual")).toBe(40000);
  });
});

describe("percentile", () => {
  it("vacío: null", () => {
    expect(percentile([], 50)).toBeNull();
  });

  it("interpola linealmente (tipo 7)", () => {
    expect(percentile([1, 2, 3, 4], 50)).toBe(2.5);
    expect(percentile([1, 2, 3, 4], 25)).toBe(1.75);
    expect(percentile([1, 2, 3, 4], 75)).toBe(3.25);
  });

  it("un solo valor", () => {
    expect(percentile([7], 25)).toBe(7);
  });

  it("extremos", () => {
    expect(percentile([1, 5, 9], 0)).toBe(1);
    expect(percentile([1, 5, 9], 100)).toBe(9);
  });
});

describe("summarizeSalaries", () => {
  const values = (n: number) => Array.from({ length: n }, (_, i) => (i + 1) * 1000);

  it("con N = 9 no hay suficiente", () => {
    const s = summarizeSalaries([...values(9), null, null], 11);
    expect(s).toEqual({
      informed: 9,
      total: 11,
      enough: false,
      p25: null,
      median: null,
      p75: null,
    });
  });

  it("con N = 10 sí, redondeado a enteros", () => {
    expect(MIN_SALARY_SAMPLE).toBe(10);
    const s = summarizeSalaries(values(10), 10);
    expect(s).toEqual({
      informed: 10,
      total: 10,
      enough: true,
      p25: 3250,
      median: 5500,
      p75: 7750,
    });
  });

  it("ordena antes de calcular y redondea", () => {
    const shuffled = [...values(10)].reverse();
    shuffled[0] = 1001;
    const s = summarizeSalaries(shuffled, 12);
    expect(Number.isInteger(s.median)).toBe(true);
    expect(s.p25).toBeLessThan(s.median ?? 0);
  });

  it("pool vacío", () => {
    expect(summarizeSalaries([], 0)).toMatchObject({ informed: 0, total: 0, enough: false });
  });
});
