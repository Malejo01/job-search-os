import { z } from "zod";

/**
 * Aviso de anomalía de gasto de IA (`/admin/salud`). Puro: valida lo que devuelve
 * `admin_llm_spend_anomalies()` (rls/0056) y aplica la regla. Una tarea está en anomalía si su gasto de
 * las últimas 24 h pasa 3 veces su promedio diario de los 7 días anteriores y llega al gasto mínimo de USD 0,10
 * (por debajo del piso no se avisa, aunque multiplique el promedio).
 *
 * Tarea sin historia (promedio 0): si llega al piso, avisa, sin cantidad de veces (`times` null). Es lo
 * conservador para el gasto: una tarea nueva o un gasto inesperado en una dormida no pasa en silencio.
 */
export const ANOMALY_MULTIPLE = 3;
export const ANOMALY_FLOOR_USD = 0.1;
const HISTORY_DAYS = 7;
/** Tolerancia de coma flotante: «justo 3 veces» no es pasarlo (0,3 × 3 da 0,8999…). */
const EPSILON = 1e-9;

const usd = z.number().nonnegative();
const RowsSchema = z.array(z.object({ task: z.string(), usd_24h: usd, usd_prev_7d: usd }));

export type SpendAnomalyInput = { task: string; usd24h: number; usdPrev7d: number };

export type SpendAnomaly = {
  task: string;
  usd24h: number;
  /** Promedio diario de los 7 días anteriores a las últimas 24 h. */
  avg7dUsd: number;
  /** Cuántas veces el promedio; null si la tarea no tenía historia. */
  times: number | null;
  noHistory: boolean;
};

/** Falla cerrado: si la forma no es la esperada, null (el bloque dice que no se pudo leer). */
export function parseSpendAnomalyRows(raw: unknown): SpendAnomalyInput[] | null {
  const parsed = RowsSchema.safeParse(raw);
  if (!parsed.success) return null;
  return parsed.data.map((r) => ({ task: r.task, usd24h: r.usd_24h, usdPrev7d: r.usd_prev_7d }));
}

export function detectSpendAnomalies(
  rows: SpendAnomalyInput[],
  options: { floorUsd?: number; multiple?: number } = {},
): SpendAnomaly[] {
  const floor = options.floorUsd ?? ANOMALY_FLOOR_USD;
  const multiple = options.multiple ?? ANOMALY_MULTIPLE;
  const out: SpendAnomaly[] = [];
  for (const r of rows) {
    if (!Number.isFinite(r.usd24h) || !Number.isFinite(r.usdPrev7d)) continue;
    if (r.usd24h < floor || r.usd24h <= 0) continue;
    const avg = Math.max(r.usdPrev7d, 0) / HISTORY_DAYS;
    if (avg === 0) {
      out.push({ task: r.task, usd24h: r.usd24h, avg7dUsd: 0, times: null, noHistory: true });
    } else if (r.usd24h - avg * multiple > EPSILON) {
      out.push({
        task: r.task,
        usd24h: r.usd24h,
        avg7dUsd: avg,
        times: r.usd24h / avg,
        noHistory: false,
      });
    }
  }
  return out.sort((a, b) => b.usd24h - a.usd24h || a.task.localeCompare(b.task));
}
