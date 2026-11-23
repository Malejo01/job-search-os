import { describe, expect, it } from "vitest";
import {
  ANOMALY_FLOOR_USD,
  ANOMALY_MULTIPLE,
  detectSpendAnomalies,
  parseSpendAnomalyRows,
} from "./llm-spend-anomaly";

// usdPrev7d = gasto de los 7 días anteriores a las últimas 24 h; el promedio diario es /7
const row = (task: string, usd24h: number, usdPrev7d: number) => ({ task, usd24h, usdPrev7d });

describe("detectSpendAnomalies", () => {
  it("usa umbral 3 y gasto mínimo de USD 0,10", () => {
    expect(ANOMALY_MULTIPLE).toBe(3);
    expect(ANOMALY_FLOOR_USD).toBe(0.1);
  });

  it("avisa cuando las 24 h pasan 3 veces el promedio diario de 7 días", () => {
    const [a] = detectSpendAnomalies([row("tarea_a", 1.0, 2.1)]); // promedio 0,30
    expect(a).toMatchObject({ task: "tarea_a", usd24h: 1.0, avg7dUsd: 0.3 });
    expect(a!.times).toBeCloseTo(1 / 0.3, 10);
    expect(a!.noHistory).toBe(false);
  });

  it("justo en 3 veces no avisa: tiene que pasarlo", () => {
    expect(detectSpendAnomalies([row("tarea_a", 0.9, 2.1)])).toEqual([]);
    expect(detectSpendAnomalies([row("tarea_a", 0.9001, 2.1)])).toHaveLength(1);
  });

  it("por debajo del piso no avisa, aunque multiplique el promedio", () => {
    expect(detectSpendAnomalies([row("tarea_a", 0.09, 0.07)])).toEqual([]);
  });

  it("en el piso exacto sí puede avisar", () => {
    expect(detectSpendAnomalies([row("tarea_a", 0.1, 0.07)])).toHaveLength(1);
  });

  it("tarea sin historia: avisa si pasa el piso, sin cantidad de veces", () => {
    const [a] = detectSpendAnomalies([row("tarea_nueva", 0.5, 0)]);
    expect(a).toMatchObject({ task: "tarea_nueva", avg7dUsd: 0, times: null, noHistory: true });
    expect(detectSpendAnomalies([row("tarea_nueva", 0.05, 0)])).toEqual([]);
  });

  it("ordena por gasto de 24 h y ignora lo normal", () => {
    const out = detectSpendAnomalies([
      row("tarea_normal", 1, 7),
      row("tarea_b", 0.5, 0.7),
      row("tarea_c", 2, 0.7),
    ]);
    expect(out.map((a) => a.task)).toEqual(["tarea_c", "tarea_b"]);
  });

  it("valores no finitos o negativos no avisan", () => {
    expect(detectSpendAnomalies([row("x", Number.NaN, 0), row("y", -1, 0)])).toEqual([]);
  });
});

describe("parseSpendAnomalyRows", () => {
  it("acepta la forma esperada y falla cerrado con otra", () => {
    const raw = [{ task: "tarea_a", usd_24h: 1, usd_prev_7d: 2 }];
    expect(parseSpendAnomalyRows(raw)).toEqual([row("tarea_a", 1, 2)]);
    expect(parseSpendAnomalyRows(null)).toBeNull();
    expect(parseSpendAnomalyRows([{ task: "a", usd_24h: "x", usd_prev_7d: 1 }])).toBeNull();
  });
});
