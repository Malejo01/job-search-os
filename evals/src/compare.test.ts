import { describe, expect, it } from "vitest";
import { compareReports, needsRecompute } from "./compare";
import { computeMetrics } from "./metrics";
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

const report = (jobs: JobReport[], strip = false): Report => {
  const metrics = computeMetrics(jobs, "human_score_match");
  if (strip) delete (metrics as Partial<typeof metrics>).false_discard_total;
  return {
    meta: { prompt: "evaluate_job@v1.3.2", model: "m", tokens_in: 0, tokens_out: 0, cost_usd: 0 },
    metrics,
    jobs,
  } as unknown as Report;
};

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
