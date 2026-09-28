import { describe, expect, it } from "vitest";
import { isPartTimeTitle, salaryAsk, type SalaryJob } from "./salary";

const FLOORS = { profileFloorUsd: 1500, criteriaFloorUsd: 1500 };
const job = (p: Partial<SalaryJob> = {}): SalaryJob => ({
  title: "Backend Engineer",
  salaryMinUsd: null,
  salaryMaxUsd: null,
  salaryPeriod: null,
  salaryNote: null,
  weeklyHours: null,
  ...p,
});
const ranged = (min: number | null, max: number | null, p: Partial<SalaryJob> = {}) =>
  job({ salaryMinUsd: min, salaryMaxUsd: max, salaryPeriod: "mensual", ...p });

describe("salaryAsk (JS-053): pedir max(mínimo, piso)", () => {
  it("rango publicado con mínimo sobre el piso → pide el mínimo", () => {
    expect(salaryAsk(ranged(3200, 4500), FLOORS)).toEqual({
      kind: "pedir",
      usdMonthly: 3200,
      basis: "minimo_del_rango",
    });
  });

  it("mínimo bajo el piso y máximo sobre el piso → pide el piso", () => {
    expect(salaryAsk(ranged(1000, 3000), FLOORS)).toEqual({
      kind: "pedir",
      usdMonthly: 1500,
      basis: "piso",
    });
  });

  it("máximo igual al piso no es 'bajo el piso' → pide el piso", () => {
    expect(salaryAsk(ranged(1100, 1500), FLOORS)).toEqual({
      kind: "pedir",
      usdMonthly: 1500,
      basis: "piso",
    });
  });

  it("sin sueldo publicado → pide el piso", () => {
    expect(salaryAsk(job(), FLOORS)).toEqual({
      kind: "pedir",
      usdMonthly: 1500,
      basis: "piso_sin_rango",
    });
  });

  it("solo mínimo publicado → max(mínimo, piso)", () => {
    expect(salaryAsk(ranged(2600, null), FLOORS)).toMatchObject({ usdMonthly: 2600 });
    expect(salaryAsk(ranged(1200, null), FLOORS)).toMatchObject({ usdMonthly: 1500 });
  });

  it("solo máximo publicado, sobre el piso → pide el piso", () => {
    expect(salaryAsk(ranged(null, 3000), FLOORS)).toEqual({
      kind: "pedir",
      usdMonthly: 1500,
      basis: "piso",
    });
  });
});

describe("salaryAsk: bajo_piso", () => {
  it("todo el rango bajo el piso → marca, sin número", () => {
    expect(salaryAsk(ranged(800, 1400), FLOORS)).toEqual({
      kind: "bajo_piso",
      floorUsd: 1500,
      maxUsd: 1400,
    });
  });

  it("solo máximo publicado y bajo el piso → marca", () => {
    expect(salaryAsk(ranged(null, 1400), FLOORS)).toMatchObject({ kind: "bajo_piso" });
  });
});

describe("salaryAsk: no_normalizable", () => {
  it("por hora o anual → marca, no convierte", () => {
    expect(salaryAsk(ranged(70, 126, { salaryPeriod: "hora" }), FLOORS)).toMatchObject({
      kind: "no_normalizable",
    });
    expect(salaryAsk(ranged(40000, 60000, { salaryPeriod: "anual" }), FLOORS)).toMatchObject({
      kind: "no_normalizable",
    });
  });

  it("montos sin período → marca", () => {
    expect(salaryAsk(ranged(3000, 4000, { salaryPeriod: null }), FLOORS)).toMatchObject({
      kind: "no_normalizable",
    });
  });

  it("la nota dice pesos u otra moneda → marca aunque haya montos", () => {
    for (const salaryNote of [
      "pagado en ARS",
      "Sueldo en pesos argentinos",
      "EUR 3.000 brutos",
      "€45k",
      "R$ 8.000 (BRL)",
      "MXN 40,000",
    ]) {
      expect(salaryAsk(ranged(5000, 5000, { salaryNote }), FLOORS), salaryNote).toMatchObject({
        kind: "no_normalizable",
      });
    }
  });

  it("nota sin montos en USD (Indeed: sueldo sin moneda) → marca", () => {
    expect(salaryAsk(job({ salaryNote: "3.000 - 4.000 por mes" }), FLOORS)).toMatchObject({
      kind: "no_normalizable",
    });
  });

  it("una nota en USD con montos normalizados no bloquea", () => {
    expect(
      salaryAsk(ranged(3000, 4000, { salaryNote: "USD, pago por plataforma" }), FLOORS),
    ).toMatchObject({ kind: "pedir", usdMonthly: 3000 });
  });
});

describe("salaryAsk: part_time", () => {
  it("menos de 30 h semanales → marca, sin calcular", () => {
    expect(salaryAsk(ranged(3000, 4000, { weeklyHours: 20 }), FLOORS)).toEqual({
      kind: "part_time",
      reason: "20 h semanales (< 30)",
    });
  });

  it("30 h o más no es part-time", () => {
    expect(salaryAsk(ranged(3000, 4000, { weeklyHours: 30 }), FLOORS)).toMatchObject({
      kind: "pedir",
    });
  });

  it("título con palabra cerrada → marca", () => {
    expect(salaryAsk(ranged(3000, 4000, { title: "Fractional CTO" }), FLOORS)).toMatchObject({
      kind: "part_time",
    });
  });

  it("part_time gana a no_normalizable y a bajo_piso", () => {
    expect(
      salaryAsk(ranged(10, 20, { salaryPeriod: "hora", title: "Part-time AI Engineer" }), FLOORS),
    ).toMatchObject({ kind: "part_time" });
    expect(salaryAsk(ranged(500, 900, { weeklyHours: 15 }), FLOORS)).toMatchObject({
      kind: "part_time",
    });
  });

  it("no_normalizable gana a bajo_piso", () => {
    expect(salaryAsk(ranged(500, 900, { salaryNote: "en pesos" }), FLOORS)).toMatchObject({
      kind: "no_normalizable",
    });
  });
});

describe("isPartTimeTitle: palabras cerradas", () => {
  it.each([
    "Part-time Developer",
    "Developer (part time)",
    "Fractional Head of AI",
    "Desarrollador medio tiempo",
    "Analista - Media Jornada",
  ])("sí: %s", (t) => expect(isPartTimeTitle(t)).toBe(true));

  it.each(["Full-time Developer", "Partner Engineer", "Tiempo completo", "Parte del equipo"])(
    "no: %s",
    (t) => expect(isPartTimeTitle(t)).toBe(false),
  );
});

describe("salaryAsk: piso_inconsistente", () => {
  it("perfil y criterios activos distintos → marca en vez de número", () => {
    expect(
      salaryAsk(ranged(3200, 4500), { profileFloorUsd: 1500, criteriaFloorUsd: 1700 }),
    ).toEqual({ kind: "piso_inconsistente", profileFloorUsd: 1500, criteriaFloorUsd: 1700 });
  });

  it("falta alguno de los dos → marca", () => {
    expect(salaryAsk(job(), { profileFloorUsd: null, criteriaFloorUsd: 1500 })).toMatchObject({
      kind: "piso_inconsistente",
    });
  });

  it("solo reemplaza a los casos que usan el piso: part_time y no_normalizable se marcan igual", () => {
    const bad = { profileFloorUsd: 1500, criteriaFloorUsd: 1700 };
    expect(salaryAsk(ranged(100, 200, { weeklyHours: 10 }), bad)).toMatchObject({
      kind: "part_time",
    });
    expect(salaryAsk(ranged(70, 90, { salaryPeriod: "hora" }), bad)).toMatchObject({
      kind: "no_normalizable",
    });
    expect(salaryAsk(ranged(100, 200), bad)).toMatchObject({ kind: "piso_inconsistente" });
  });
});
