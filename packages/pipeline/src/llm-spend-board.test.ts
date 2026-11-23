import { describe, expect, it } from "vitest";
import {
  buildSpendBoard,
  fillDailySeries,
  formatUsd,
  parseSpendBoard,
  projectMonth,
  type SpendBoardRaw,
} from "./llm-spend-board";

const RAW: SpendBoardRaw = {
  generated_at: "2026-11-23T12:00:00Z",
  today: "2026-11-23",
  days: 30,
  daily: [
    { day: "2026-11-21", usd: 0.5, calls: 10, failed: 1 },
    { day: "2026-11-23", usd: 1.5, calls: 20, failed: 0 },
  ],
  by_task: [
    { task: "tarea_a", usd: 0.5, calls: 25, failed: 1, fallbacks: 3 },
    { task: "tarea_b", usd: 1.5, calls: 5, failed: 0, fallbacks: 0 },
  ],
  by_model: [
    { model: "modelo-x", usd: 1.5, calls: 5, failed: 0 },
    { model: "modelo-y", usd: 0.5, calls: 25, failed: 1 },
  ],
  totals: { usd: 2, calls: 30, failed: 1, fallbacks: 3, unpriced: 2 },
};

describe("formatUsd", () => {
  it("usa coma decimal y punto de miles", () => {
    expect(formatUsd(0.1)).toBe("USD 0,10");
    // Miles con punto y decimales con coma (la forma, sin fijar una cifra)
    expect(formatUsd(7000.25)).toMatch(/^USD \d\.\d{3},\d{2}$/);
    expect(formatUsd(12000000)).toMatch(/^USD \d{2}\.\d{3}\.\d{3},00$/);
    expect(formatUsd(0.0456, 3)).toBe("USD 0,046");
    expect(formatUsd(0)).toBe("USD 0,00");
  });
});

describe("parseSpendBoard", () => {
  it("acepta la forma esperada", () => {
    expect(parseSpendBoard(RAW)).toEqual(RAW);
  });
  it("falla cerrado ante una forma distinta", () => {
    expect(parseSpendBoard(null)).toBeNull();
    expect(parseSpendBoard({ ...RAW, daily: "x" })).toBeNull();
    expect(parseSpendBoard({ ...RAW, today: "ayer" })).toBeNull();
    expect(parseSpendBoard({ ...RAW, totals: { ...RAW.totals, usd: -1 } })).toBeNull();
  });
});

describe("fillDailySeries", () => {
  it("devuelve un día por cada uno de la ventana, con ceros donde no hubo llamadas", () => {
    const out = fillDailySeries(RAW.daily, "2026-11-23", 4);
    expect(out.map((d) => d.day)).toEqual(["2026-11-20", "2026-11-21", "2026-11-22", "2026-11-23"]);
    expect(out[0]).toEqual({ day: "2026-11-20", usd: 0, calls: 0, failed: 0 });
    expect(out[3]!.usd).toBe(1.5);
  });
  it("cruza el cambio de mes y de año", () => {
    const out = fillDailySeries([], "2027-01-02", 4);
    expect(out.map((d) => d.day)).toEqual(["2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"]);
  });
});

describe("projectMonth", () => {
  const series = fillDailySeries(
    [
      { day: "2026-11-17", usd: 1, calls: 1, failed: 0 },
      { day: "2026-11-18", usd: 1, calls: 1, failed: 0 },
      { day: "2026-11-19", usd: 1, calls: 1, failed: 0 },
      { day: "2026-11-20", usd: 1, calls: 1, failed: 0 },
      { day: "2026-11-21", usd: 1, calls: 1, failed: 0 },
      { day: "2026-11-22", usd: 1, calls: 1, failed: 0 },
      { day: "2026-11-23", usd: 1, calls: 1, failed: 0 },
    ],
    "2026-11-23",
    30,
  );
  it("proyecta con el promedio de los últimos 7 días contra el tope por 30", () => {
    const p = projectMonth(series, 2);
    expect(p.avg7).toBe(1);
    expect(p.avg30).toBeCloseTo(7 / 30, 10);
    expect(p.projectedUsd).toBe(30);
    expect(p.capMonthUsd).toBe(60);
    expect(p.ratio).toBe(0.5);
    expect(p.level).toBe("verde");
  });
  it("amarillo desde 70 % y rojo desde 100 % del tope", () => {
    expect(projectMonth(series, 1.4).level).toBe("amarillo");
    expect(projectMonth(series, 1).level).toBe("rojo");
  });
  it("sin tope (null o 0) no hay comparación y el nivel es gris", () => {
    for (const cap of [null, 0]) {
      const p = projectMonth(series, cap);
      expect(p.capMonthUsd).toBeNull();
      expect(p.ratio).toBeNull();
      expect(p.level).toBe("gris");
    }
  });
  it("sin datos proyecta 0", () => {
    expect(projectMonth([], 2).projectedUsd).toBe(0);
  });
});

describe("buildSpendBoard", () => {
  it("arma series, filas con participación y la proyección", () => {
    const b = buildSpendBoard(RAW, 2);
    expect(b.daily).toHaveLength(30);
    expect(b.daily.at(-1)!.day).toBe("2026-11-23");
    expect(b.tasks.map((t) => t.task)).toEqual(["tarea_b", "tarea_a"]);
    expect(b.tasks[0]!.share).toBe(0.75);
    expect(b.models.map((m) => m.model)).toEqual(["modelo-x", "modelo-y"]);
    expect(b.tasks.find((t) => t.task === "tarea_a")!.fallbackRate).toBeCloseTo(3 / 25, 10);
    expect(b.totals.failureRate).toBeCloseTo(1 / 30, 10);
    expect(b.totals.fallbackRate).toBeCloseTo(3 / 30, 10);
    expect(b.projection.capMonthUsd).toBe(60);
    expect(b.maxDailyUsd).toBe(1.5);
  });
  it("sin llamadas las tasas son 0 y la participación 0, sin dividir por cero", () => {
    const empty: SpendBoardRaw = {
      ...RAW,
      daily: [],
      by_task: [],
      by_model: [],
      totals: { usd: 0, calls: 0, failed: 0, fallbacks: 0, unpriced: 0 },
    };
    const b = buildSpendBoard(empty, null);
    expect(b.totals.failureRate).toBe(0);
    expect(b.totals.fallbackRate).toBe(0);
    expect(b.maxDailyUsd).toBe(0);
    expect(b.projection.level).toBe("gris");
  });
});
