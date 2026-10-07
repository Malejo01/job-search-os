import { describe, expect, it } from "vitest";
import { criteriaHash, goldenJobs } from "./golden";
import { recomputeReport, criteriaHashNote, formatRecompute } from "./recompute";
import { computeMetrics } from "./metrics";
import type { JobReport, Report } from "./run";

/** Reporte mínimo de un solo job del golden, con las anclas que el reporte "guardó". */
function reportWith(over: Partial<JobReport>, metaOver: Record<string, unknown> = {}): Report {
  const g = goldenJobs[0]!;
  const job = {
    id: g.id,
    empresa: g.empresa,
    titulo: g.titulo,
    ubicacion_raw: g.ubicacion_raw,
    human_score: g.human_score,
    human_score_match: g.human_score_match,
    human_blockers: g.human_blockers,
    human_blockers_legacy: g.bloqueadores,
    human_risks: g.human_risks,
    human_discipline: g.disciplina,
    human_action: g.accion,
    anchor_source: g.anchor_source ?? "human",
    human_location_ok: g.location_ok,
    human_location_ok_clean: g.human_location_ok,
    model_score: null,
    scores: [],
    model_blockers: [],
    model_risks: [],
    model_discipline: null,
    model_action: null,
    model_location_ok: null,
    unstable: false,
    delta: null,
    veredicto: null,
    confianza: null,
    model_action_suggested: null,
    model_gaps: [],
    model_raw: null,
    decision: null,
    errors: [],
    ...over,
  } as JobReport;
  const metrics = computeMetrics([job], "human_score_match");
  return {
    meta: { prompt: "evaluate_job@v1.3.2", model: "m", ...metaOver },
    metrics,
    thresholds: [],
    diagnostics: {
      missed_blockers: [],
      false_blockers: [],
      missed_risks: [],
      location_mismatches: [],
    },
    jobs: [job],
  } as unknown as Report;
}

describe("recompute relee las anclas del golden actual (JS-064)", () => {
  const g = goldenJobs[0]!;
  const otherAction = g.accion === "descartar" ? "guardar" : "descartar";

  it("usa la acción del golden y avisa la ancla cambiada, solo con IDs y enums", () => {
    const report = reportWith({ human_action: otherAction, anchor_source: "assisted" });
    const { report: out, notes } = recomputeReport(report);
    expect(out.jobs[0]!.human_action).toBe(g.accion);
    expect(out.jobs[0]!.anchor_source).toBe(g.anchor_source ?? "human");
    expect(notes).toContain(`ancla actualizada: id ${g.id}, acción ${otherAction} → ${g.accion}`);
    expect(notes.some((n) => n.includes(`id ${g.id}, anchor_source assisted →`))).toBe(
      (g.anchor_source ?? "human") !== "assisted",
    );
  });

  it("con anclasDelReporte reproduce el cálculo viejo y no avisa", () => {
    const report = reportWith({ human_action: otherAction });
    const { report: out, notes } = recomputeReport(report, { anclasDelReporte: true });
    expect(out.jobs[0]!.human_action).toBe(otherAction);
    expect(notes.some((n) => n.startsWith("ancla actualizada"))).toBe(false);
  });

  it("el flag recupera las anclas de la corrida aunque el reporte ya se haya recalculado", () => {
    const first = recomputeReport(reportWith({ human_action: otherAction })).report;
    expect(first.jobs[0]!.human_action).toBe(g.accion);
    const again = recomputeReport(first, { anclasDelReporte: true }).report;
    expect(again.jobs[0]!.human_action).toBe(otherAction);
  });

  it("sin cambios no avisa nada", () => {
    const { notes } = recomputeReport(reportWith({}));
    expect(notes.some((n) => n.startsWith("ancla actualizada"))).toBe(false);
  });
});

describe("hash de criterios (JS-067)", () => {
  it("avisa 'sin hash' en un reporte viejo y 'no coincide' si difiere", () => {
    expect(criteriaHashNote(undefined)).toMatch(/sin hash/);
    expect(criteriaHashNote("000000000000")).toMatch(/no coincide/);
    expect(criteriaHashNote(criteriaHash)).toBeNull();
  });
});

describe("formatRecompute", () => {
  it("imprime por origen, ubicación cruda y final, y riesgos por tipo", () => {
    const { report } = recomputeReport(reportWith({}));
    const text = formatRecompute(report, { ...report.metrics }, []).join("\n");
    expect(text).toContain("por origen");
    expect(text).toContain("location_risk_recall cruda");
    expect(text).toContain("final");
    expect(text).toContain("risks_recall por tipo");
    expect(text).not.toContain("CORTADO");
  });

  it("muestra la línea de corte si el reporte fue cortado por el tope de gasto", () => {
    const { report } = recomputeReport(
      reportWith(
        {},
        { cut_by_budget: { max_usd: 0.5, spent_usd: 0.49, calls_done: 40, calls_planned: 108 } },
      ),
    );
    const lines = formatRecompute(report, { ...report.metrics }, []);
    expect(lines[0]).toMatch(/^!! CORTADO por tope de gasto/);
  });
});
