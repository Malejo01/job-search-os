import { z } from "zod";

/**
 * Tablero de gasto de IA (`/admin/costos`). Puro: valida lo que devuelve `admin_llm_spend_board()`
 * (rls/0055), completa los días sin llamadas, arma las filas con su participación y proyecta el mes
 * contra el tope diario. Solo agregados: la base no devuelve ids, emails ni textos de nadie.
 */

const usd = z.number().nonnegative();
const count = z.number().int().nonnegative();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const SpendBoardSchema = z.object({
  generated_at: z.string(),
  /** Hoy en Argentina (`YYYY-MM-DD`): último día de la serie. */
  today: day,
  days: z.number().int().positive(),
  daily: z.array(z.object({ day, usd, calls: count, failed: count })),
  by_task: z.array(
    z.object({ task: z.string(), usd, calls: count, failed: count, fallbacks: count }),
  ),
  by_model: z.array(z.object({ model: z.string(), usd, calls: count, failed: count })),
  totals: z.object({ usd, calls: count, failed: count, fallbacks: count, unpriced: count }),
});

export type SpendBoardRaw = z.infer<typeof SpendBoardSchema>;
export type DailySpend = SpendBoardRaw["daily"][number];

/** Falla cerrado: si la forma no es la esperada, null (la pantalla dice que no hay datos). */
export function parseSpendBoard(raw: unknown): SpendBoardRaw | null {
  const parsed = SpendBoardSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** Monto en USD con coma decimal y punto de miles, sin depender de los datos de idioma del runtime. */
export function formatUsd(value: number, digits = 2): string {
  const [int = "0", dec] = Math.abs(value).toFixed(digits).split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${value < 0 ? "-" : ""}USD ${grouped}${dec ? `,${dec}` : ""}`;
}

function shiftDay(iso: string, delta: number): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}

/** Un día por cada uno de los `days` que terminan en `endDay`, con ceros donde no hubo llamadas. */
export function fillDailySeries(daily: DailySpend[], endDay: string, days: number): DailySpend[] {
  const byDay = new Map(daily.map((d) => [d.day, d]));
  const out: DailySpend[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const key = shiftDay(endDay, -i);
    out.push(byDay.get(key) ?? { day: key, usd: 0, calls: 0, failed: 0 });
  }
  return out;
}

export type ProjectionLevel = "verde" | "amarillo" | "rojo" | "gris";

export type MonthProjection = {
  /** Promedio diario de los últimos 7 días de la serie. */
  avg7: number;
  /** Promedio diario de toda la serie. */
  avg30: number;
  /** `avg7 × 30`: lo que costaría un mes si sigue el ritmo de la última semana. */
  projectedUsd: number;
  /** `tope diario × 30`; null si no hay tope (variable en 0 o inválida). */
  capMonthUsd: number | null;
  ratio: number | null;
  level: ProjectionLevel;
};

const MONTH_DAYS = 30;
const WARN_RATIO = 0.7;

export function projectMonth(series: DailySpend[], capDailyUsd: number | null): MonthProjection {
  const sum = (rows: DailySpend[]) => rows.reduce((acc, d) => acc + d.usd, 0);
  const last7 = series.slice(-7);
  const avg7 = last7.length ? sum(last7) / 7 : 0;
  const avg30 = series.length ? sum(series) / series.length : 0;
  const projectedUsd = avg7 * MONTH_DAYS;
  const capMonthUsd = capDailyUsd !== null && capDailyUsd > 0 ? capDailyUsd * MONTH_DAYS : null;
  const ratio = capMonthUsd === null ? null : projectedUsd / capMonthUsd;
  const level: ProjectionLevel =
    ratio === null ? "gris" : ratio >= 1 ? "rojo" : ratio >= WARN_RATIO ? "amarillo" : "verde";
  return { avg7, avg30, projectedUsd, capMonthUsd, ratio, level };
}

export type SpendTaskRow = {
  task: string;
  usd: number;
  calls: number;
  failed: number;
  fallbacks: number;
  share: number;
  failureRate: number;
  fallbackRate: number;
};

export type SpendModelRow = {
  model: string;
  usd: number;
  calls: number;
  failed: number;
  share: number;
  failureRate: number;
};

export type SpendBoard = {
  generatedAt: string;
  daily: DailySpend[];
  maxDailyUsd: number;
  tasks: SpendTaskRow[];
  models: SpendModelRow[];
  totals: SpendBoardRaw["totals"] & { failureRate: number; fallbackRate: number };
  projection: MonthProjection;
};

const ratio = (n: number, d: number) => (d > 0 ? n / d : 0);

/** Arma lo que muestra la pantalla; `capDailyUsd` lo resuelve el servidor (`dailyCapFromEnv`). */
export function buildSpendBoard(raw: SpendBoardRaw, capDailyUsd: number | null): SpendBoard {
  const daily = fillDailySeries(raw.daily, raw.today, raw.days);
  const total = raw.totals.usd;
  const byUsd = <T extends { usd: number }>(rows: T[], key: (r: T) => string) =>
    [...rows].sort((a, b) => b.usd - a.usd || key(a).localeCompare(key(b)));
  return {
    generatedAt: raw.generated_at,
    daily,
    maxDailyUsd: daily.reduce((m, d) => Math.max(m, d.usd), 0),
    tasks: byUsd(raw.by_task, (t) => t.task).map((t) => ({
      ...t,
      share: ratio(t.usd, total),
      failureRate: ratio(t.failed, t.calls),
      fallbackRate: ratio(t.fallbacks, t.calls),
    })),
    models: byUsd(raw.by_model, (m) => m.model).map((m) => ({
      ...m,
      share: ratio(m.usd, total),
      failureRate: ratio(m.failed, m.calls),
    })),
    totals: {
      ...raw.totals,
      failureRate: ratio(raw.totals.failed, raw.totals.calls),
      fallbackRate: ratio(raw.totals.fallbacks, raw.totals.calls),
    },
    projection: projectMonth(daily, capDailyUsd),
  };
}
