import { describe, expect, it } from "vitest";
import { compareReports, metricDispersion, needsRecompute } from "./compare";
import { computeMetrics, type Metrics } from "./metrics";
import type { JobReport, Report } from "./run";

const job = (over: Partial<JobReport> = {}): JobReport =>
  ({
    id: 1,
    empresa: "Empresa A",
    human_score: 6,
    human_score_match: 6,
    human_blockers: [],
    human_blockers_legacy: [],
    human_risks: [],
    human_discipline: "ai_engineer",
    human_action: "guardar",
    human_location_ok: "ok",
    human_location_ok_clean: "ok",
    model_score: 6,
    scores: [6],
    model_blockers: [],
    model_risks: [],
    model_discipline: "ai_engineer",
    model_action: "guardar",
    model_location_ok: "ok",
    unstable: false,
    ...over,
  }) as JobReport;

const report = (jobs: JobReport[], strip = false, metricsPerRun?: Metrics[]): Report => {
  const metrics = computeMetrics(jobs, "human_score_match");
  if (strip) delete (metrics as Partial<typeof metrics>).false_discard_total;
  return {
    meta: {
      prompt: "evaluate_job@v1.3.2",
      model: "m",
      tokens_in: 0,
      tokens_out: 0,
      cost_usd: 0,
      runs: metricsPerRun ? metricsPerRun.length : 1,
    },
    metrics,
    ...(metricsPerRun ? { metrics_per_run: metricsPerRun } : {}),
    jobs,
  } as unknown as Report;
};

describe("compare: reportes cortados por tope de gasto", () => {
  it("avisa arriba de la comparación qué lado (A/B) quedó cortado", () => {
    const fresh = report([job({ prefilter_discard: false })]);
    const cut = report([job({ prefilter_discard: false })]);
    cut.meta.cut_by_budget = { max_usd: 0.5, spent_usd: 0.49, calls_done: 40, calls_planned: 108 };
    const text = compareReports(fresh, cut);
    expect(text).toMatch(/^B: !! CORTADO por tope de gasto/);
    expect(text).not.toMatch(/A: !! CORTADO/);
    expect(compareReports(fresh, fresh)).not.toContain("CORTADO");
  });
});

describe("compare: reportes sin recomputar", () => {
  it("avisa cuando un reporte no trae los campos de JS-067 y no lo hace si ambos los traen", () => {
    const fresh = report([job({ prefilter_discard: false })]);
    const old = report([job()], true);
    expect(needsRecompute(old)).toBe(true);
    expect(needsRecompute(fresh)).toBe(false);
    expect(compareReports(fresh, old)).toContain("reporte sin recomputar");
    expect(compareReports(fresh, fresh)).not.toContain("reporte sin recomputar");
  });

  it("imprime false_discard_prefilter, false_discard_total y location_risk_recall_final", () => {
    const fresh = report([job({ prefilter_discard: false })]);
    const text = compareReports(fresh, fresh);
    expect(text).toContain("false_discard_prefilter");
    expect(text).toContain("false_discard_total");
    expect(text).toContain("location_risk_recall_final");
  });
});

describe("compare: métricas por corrida y dispersión (JS-081)", () => {
  const m1: Metrics = {
    ...computeMetrics([job({ model_score: 5 })], "human_score_match"),
    score_mae: 1.0,
    action_acc: 0.7,
    blockers_recall: 0.9,
    blockers_precision: 0.8,
    risks_recall: 0.6,
    discipline_acc: 0.75,
    false_apply: 0,
    false_discard: 1,
  };
  const m2: Metrics = {
    ...computeMetrics([job({ model_score: 6 })], "human_score_match"),
    score_mae: 0.0,
    action_acc: 0.8,
    blockers_recall: 1.0,
    blockers_precision: 0.85,
    risks_recall: 0.7,
    discipline_acc: 0.85,
    false_apply: 1,
    false_discard: 2,
  };
  const m3: Metrics = {
    ...computeMetrics([job({ model_score: 7 })], "human_score_match"),
    score_mae: 0.5,
    action_acc: 0.75,
    blockers_recall: 0.95,
    blockers_precision: 0.82,
    risks_recall: 0.65,
    discipline_acc: 0.8,
    false_apply: 0,
    false_discard: 3,
  };

  it("metricDispersion calcula correctamente media, min, max y cantidad de corridas", () => {
    const multi = report([job({ prefilter_discard: false })], false, [m1, m2, m3]);
    const dispScore = metricDispersion(multi, (m) => m.score_mae);
    expect(dispScore).toEqual({
      mean: 0.5,
      min: 0.0,
      max: 1.0,
      runs: 3,
    });

    const dispAction = metricDispersion(multi, (m) => m.action_acc);
    expect(dispAction).toEqual({
      mean: 0.75,
      min: 0.7,
      max: 0.8,
      runs: 3,
    });
  });

  it("metricDispersion devuelve null si el reporte no tiene múltiples corridas", () => {
    const single = report([job({ prefilter_discard: false })], false, [m1]);
    expect(metricDispersion(single, (m) => m.score_mae)).toBeNull();

    const none = report([job({ prefilter_discard: false })]);
    expect(metricDispersion(none, (m) => m.score_mae)).toBeNull();
  });

  it("compareReports muestra media y rango tanto en las celdas como en la sección de dispersión", () => {
    const multiA = report([job({ prefilter_discard: false })], false, [m1, m2, m3]);
    const multiB = report([job({ prefilter_discard: false })], false, [m2, m3, m2]);
    const text = compareReports(multiA, multiB);

    // Muestra sección de dispersión
    expect(text).toContain("Métricas por corrida (media y rango):");
    expect(text).toContain("action_acc");
    expect(text).toContain("score_mae");

    // Contiene media y rango formateados
    expect(text).toMatch(/media 75%, rango 70%–80%/);
    expect(text).toMatch(/media 0\.50, rango 0\.00–1\.00/);

    // En las celdas principales también aparece media y rango
    expect(text).toMatch(/action_acc.*\(media 75%, rango 70%–80%\)/);
  });
});
