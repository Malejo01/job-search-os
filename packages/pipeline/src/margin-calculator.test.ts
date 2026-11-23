import { describe, expect, it } from "vitest";
import {
  MARGIN_DEFAULTS,
  computeMargin,
  parseDecimalInput,
  parseMarginParams,
  type MarginInput,
} from "./margin-calculator";

// Datos inventados y redondos para que la cuenta se siga a mano
const input: MarginInput = {
  priceArs: 20_000,
  exchangeRate: 1_000,
  usage: { offers: 100, interviews: 10, coachChats: 5 },
  unitCostUsd: { offer: 0.02, interview: 0.04, coach: 0.04 },
  fixedUsd: { vercel: 20, neon: 10, other: 0 },
  mpCommissionPct: 5,
};

describe("computeMargin", () => {
  it("calcula costo de IA, margen por persona y punto de equilibrio", () => {
    const r = computeMargin(input);
    if (!r.ok) throw new Error(r.error);
    const v = r.value;
    // 100 × 0,02 + 10 × 0,04 + 5 × 0,04 = 2,60 USD = 2.600 ARS
    expect(v.aiCostUsd).toBeCloseTo(2.6, 10);
    expect(v.aiCostArs).toBeCloseTo(2_600, 6);
    // comisión 5 % de 20.000 = 1.000; neto 19.000; margen 19.000 − 2.600 = 16.400
    expect(v.commissionArs).toBeCloseTo(1_000, 6);
    expect(v.netRevenueArs).toBeCloseTo(19_000, 6);
    expect(v.marginArs).toBeCloseTo(16_400, 6);
    expect(v.marginPct).toBeCloseTo(82, 6);
    // fijos 30 USD = 30.000 ARS; 30.000 / 16.400 = 1,83 → 2 personas pagas
    expect(v.fixedArs).toBe(30_000);
    expect(v.breakEven).toEqual({ kind: "personas", people: 2 });
  });

  it("si el margen por persona no es positivo, no hay punto de equilibrio", () => {
    const r = computeMargin({ ...input, priceArs: 2_000 });
    if (!r.ok) throw new Error(r.error);
    expect(r.value.marginArs).toBeLessThan(0);
    expect(r.value.breakEven).toEqual({ kind: "no_alcanza" });
  });

  it("sin costos fijos el equilibrio es 0 personas, con margen positivo", () => {
    const r = computeMargin({ ...input, fixedUsd: { vercel: 0, neon: 0, other: 0 } });
    if (!r.ok) throw new Error(r.error);
    expect(r.value.breakEven).toEqual({ kind: "personas", people: 0 });
  });

  it("precio 0 (beca): margen negativo y porcentaje null, sin división por cero", () => {
    const r = computeMargin({ ...input, priceArs: 0 });
    if (!r.ok) throw new Error(r.error);
    expect(r.value.marginPct).toBeNull();
    expect(r.value.marginArs).toBeCloseTo(-2_600, 6);
    expect(r.value.breakEven).toEqual({ kind: "no_alcanza" });
  });

  it("falla cerrado con entradas inválidas", () => {
    expect(computeMargin({ ...input, exchangeRate: 0 }).ok).toBe(false);
    expect(computeMargin({ ...input, priceArs: -1 }).ok).toBe(false);
    expect(computeMargin({ ...input, mpCommissionPct: 100 }).ok).toBe(false);
    expect(computeMargin({ ...input, mpCommissionPct: -1 }).ok).toBe(false);
    expect(computeMargin({ ...input, usage: { ...input.usage, offers: Number.NaN } }).ok).toBe(
      false,
    );
    expect(
      computeMargin({
        ...input,
        unitCostUsd: { ...input.unitCostUsd, coach: Number.POSITIVE_INFINITY },
      }).ok,
    ).toBe(false);
    expect(computeMargin({ ...input, fixedUsd: { ...input.fixedUsd, neon: -5 } }).ok).toBe(false);
  });

  it("los valores por defecto son una entrada válida", () => {
    expect(computeMargin(MARGIN_DEFAULTS).ok).toBe(true);
  });
});

describe("parseDecimalInput", () => {
  it("acepta coma decimal, punto decimal y puntos de miles", () => {
    expect(parseDecimalInput("0,0245")).toBe(0.0245);
    expect(parseDecimalInput("0.5")).toBe(0.5);
    expect(parseDecimalInput("20.000")).toBe(20_000);
    expect(parseDecimalInput("1.570,5")).toBe(1570.5);
    expect(parseDecimalInput(" 42 ")).toBe(42);
  });
  it("rechaza lo que no es un número", () => {
    for (const bad of ["", "abc", "1e5", "-3", "1,2,3", "Infinity", "NaN", undefined, "0x10"]) {
      expect(parseDecimalInput(bad)).toBeNull();
    }
  });
});

describe("parseMarginParams", () => {
  it("sin parámetros devuelve los valores por defecto", () => {
    expect(parseMarginParams({}, MARGIN_DEFAULTS)).toEqual(MARGIN_DEFAULTS);
  });

  it("toma los válidos y ante un valor inválido o fuera de rango usa el default de ese campo", () => {
    const out = parseMarginParams(
      {
        precio: "15.000",
        tc: "0", // fuera de rango
        ofertas: "abc", // inválido
        simulaciones: "7,6", // entero: se redondea
        c_oferta: "0,03",
        comision: "99", // fuera de rango
        vercel: "-4",
      },
      MARGIN_DEFAULTS,
    );
    expect(out.priceArs).toBe(15_000);
    expect(out.exchangeRate).toBe(MARGIN_DEFAULTS.exchangeRate);
    expect(out.usage.offers).toBe(MARGIN_DEFAULTS.usage.offers);
    expect(out.usage.interviews).toBe(8);
    expect(out.unitCostUsd.offer).toBe(0.03);
    expect(out.mpCommissionPct).toBe(MARGIN_DEFAULTS.mpCommissionPct);
    expect(out.fixedUsd.vercel).toBe(MARGIN_DEFAULTS.fixedUsd.vercel);
  });

  it("si un parámetro llega repetido (arreglo) usa el primero", () => {
    expect(parseMarginParams({ precio: ["10000", "99"] }, MARGIN_DEFAULTS).priceArs).toBe(10_000);
  });

  it("acota los máximos", () => {
    const out = parseMarginParams({ precio: "999999999999", ofertas: "99999999" }, MARGIN_DEFAULTS);
    expect(out.priceArs).toBe(MARGIN_DEFAULTS.priceArs);
    expect(out.usage.offers).toBe(MARGIN_DEFAULTS.usage.offers);
  });
});
