import { monthlyUsd } from "../monthly-usd";
import type { CareerMarket } from "./types";

/** Cuántos avisos con sueldo hacen falta para mostrar números. */
export const MIN_SALARY_SAMPLE = 10;
/** USD por mes fuera de este rango se descartan (un anual cargado como mensual, un error de carga). */
export const SALARY_MONTHLY_BOUNDS: readonly [number, number] = [200, 40000];

const PERIODS = new Set(["mensual", "anual", "hora"]);

/** Punto de sueldo de un aviso en USD/mes: promedio de mínimo y máximo (o el que haya). */
export function monthlySalaryPoint(
  min: number | null,
  max: number | null,
  period: string | null,
): number | null {
  if (period === null || !PERIODS.has(period)) return null;
  const values = [min, max].filter((v): v is number => v !== null && Number.isFinite(v));
  if (!values.length) return null;
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const monthly = monthlyUsd(avg, period as "mensual" | "anual" | "hora");
  if (monthly === null) return null;
  const [lo, hi] = SALARY_MONTHLY_BOUNDS;
  return monthly < lo || monthly > hi ? null : monthly;
}

/** Percentil `p` (0 a 100) con interpolación lineal (tipo 7). `sorted` ya viene ordenado. */
export function percentile(sorted: readonly number[], p: number): number | null {
  if (!sorted.length) return null;
  const rank = (Math.min(100, Math.max(0, p)) / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  const a = sorted[lo] as number;
  const b = sorted[hi] as number;
  return a + (b - a) * (rank - lo);
}

export function summarizeSalaries(
  points: readonly (number | null)[],
  total: number,
): CareerMarket["salary"] {
  const values = points.filter((v): v is number => v !== null).sort((a, b) => a - b);
  const enough = values.length >= MIN_SALARY_SAMPLE;
  const pick = (p: number) => {
    const v = enough ? percentile(values, p) : null;
    return v === null ? null : Math.round(v);
  };
  return {
    informed: values.length,
    total,
    enough,
    p25: pick(25),
    median: pick(50),
    p75: pick(75),
  };
}
