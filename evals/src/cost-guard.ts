/**
 * Tope de gasto de evals (JS-080). Módulo puro: sin I/O y sin importar cli.ts (que ejecuta
 * main() al importarse). El tope no tiene excepción: ni --yes ni una terminal lo anulan.
 */

import type { Report } from "./run";

/** Forma mínima del estimado (run.ts exporta el tipo completo, CostEstimate). */
export type EstimateLike = { usd: number | null; calls?: number };

export type EstimateCheck = { ok: true } | { ok: false; reason: string };

/** Antes de la primera llamada: sin tarifa o sobre el tope, aborta. No recibe `yes` a propósito. */
export function checkEstimate(estimate: EstimateLike, maxUsd: number): EstimateCheck {
  if (estimate.usd === null) {
    return {
      ok: false,
      reason:
        "no hay tarifa para estimar el costo, así que no se puede garantizar --max-usd; cargá input/output_usd_per_mtok en seeds/model_routing.json",
    };
  }
  if (estimate.usd <= 0 && (estimate.calls ?? 1) > 0) {
    // Tarifa 0 o mal cargada: con costo esperado 0 el tope en vuelo no frenaría nada
    return {
      ok: false,
      reason: `el costo estimado es USD ${estimate.usd} para una corrida con llamadas: la tarifa de model_routing está en 0 o mal cargada, no se puede garantizar --max-usd`,
    };
  }
  if (estimate.usd > maxUsd) {
    return {
      ok: false,
      reason: `el costo estimado USD ${estimate.usd.toFixed(3)} supera --max-usd ${maxUsd}: subí --max-usd o reducí la corrida (--subset, --runs, --ids)`,
    };
  }
  return { ok: true };
}

/** Una línea de aviso si el reporte es parcial por el tope de gasto (vacío si no). */
export function cutLine(report: Pick<Report, "meta">): string[] {
  const c = report.meta.cut_by_budget;
  return c
    ? [
        `!! CORTADO por tope de gasto --max-usd ${c.max_usd}: ${c.calls_done}/${c.calls_planned} llamadas, USD ${c.spent_usd.toFixed(4)}. Reporte parcial: no comparar como completo.`,
      ]
    : [];
}

export type SpendGuard = {
  /** Lo gastado + las llamadas en vuelo × costo esperado + una llamada más ≤ tope. */
  canStart(): boolean;
  started(): void;
  /** Costo real de la llamada; null (sin tarifa o llamada fallida) cuenta el esperado. */
  finished(costUsd: number | null): void;
  spent(): number;
  /** Llamadas terminadas hasta ahora. */
  finishedCount(): number;
};

export function createSpendGuard(maxUsd: number, expectedPerCallUsd: number): SpendGuard {
  let spent = 0;
  let inFlight = 0;
  let finishedCount = 0;
  // Tolerancia para que 3 × 0.01 ≤ 0.03 no falle por coma flotante
  const EPS = 1e-9;
  return {
    canStart: () => spent + (inFlight + 1) * expectedPerCallUsd <= maxUsd + EPS,
    started() {
      inFlight++;
    },
    finished(costUsd) {
      inFlight = Math.max(0, inFlight - 1);
      finishedCount++;
      spent += costUsd ?? expectedPerCallUsd;
    },
    spent: () => spent,
    finishedCount: () => finishedCount,
  };
}
