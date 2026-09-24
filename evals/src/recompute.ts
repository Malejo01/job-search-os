import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Evaluation } from "@job-search-os/pipeline";
import { goldenJobs } from "./golden";
import { criteriaRules } from "./golden";
import { anchorFor, checkThresholds, computeMetrics } from "./metrics";
import { productionDecision, type JobReport, type Report } from "./run";

/**
 * Recalcula métricas y acción de un reporte guardado SIN llamar a la API. Usa la salida cruda
 * (`model_raw`) si el reporte la tiene; si es anterior a esa columna reconstruye lo que puede
 * desde los campos guardados y deja anotado qué ajustes de decide() no se pudieron aplicar
 * (años requeridos e inglés: el reporte viejo no los guardaba).
 */
export type RecomputeResult = { report: Report; partial: boolean; notes: string[] };

function reconstructRaw(j: JobReport): Evaluation | null {
  if (j.model_score === null) return null;
  return {
    score: j.model_score,
    confianza: (j.confianza as Evaluation["confianza"]) ?? "media",
    years_required: null,
    years_domain: null,
    years_discipline: null,
    location_ok: (j.model_location_ok as Evaluation["location_ok"]) ?? "ok",
    modalidad: "desconocida",
    disciplina: (j.model_discipline as Evaluation["disciplina"]) ?? "otra",
    ingles_requerido: "no_menciona",
    tipo_empresa: "desconocido",
    paises_permitidos: null,
    match_fuerte: [],
    gaps: j.model_gaps.map((g) => ({
      skill: g.skill,
      nivel: g.nivel === "must" ? "must" : "deseable",
    })),
    bloqueadores_duros: j.model_blockers,
    riesgos: j.model_risks,
    senales_positivas: [],
    veredicto: j.veredicto ?? "",
    accion_sugerida: (j.model_action_suggested as Evaluation["accion_sugerida"]) ?? "guardar",
  };
}

export function recomputeReport(report: Report): RecomputeResult {
  const anchor = anchorFor(report.meta.prompt);
  const notes: string[] = [];
  let partial = false;
  for (const j of report.jobs) {
    const golden = goldenJobs.find((g) => g.id === j.id);
    if (!golden) {
      notes.push(`job ${j.id} no está en el golden actual: se deja como estaba`);
      continue;
    }
    const raw = j.model_raw ?? reconstructRaw(j);
    if (!j.model_raw && raw) partial = true;
    const a = anchor === "human_score" ? j.human_score : j.human_score_match;
    j.delta = j.model_score !== null && a !== null ? j.model_score - a : null;
    const { action, decision } = productionDecision(golden, raw, j.model_score);
    j.model_action = action;
    j.decision = decision;
    j.model_score_final = decision?.score_final ?? null;
  }
  if (partial) {
    notes.push(
      "reporte sin model_raw: decide() se aplicó sin years_required ni ingles_requerido (bloqueador por años ≥ 8, penalización 5–7 años e inglés no se pudieron reproducir)",
    );
  }
  report.metrics = computeMetrics(report.jobs, anchor, criteriaRules.thresholds.guardar);
  report.thresholds = checkThresholds(report.metrics);
  report.meta.recomputed = `${new Date().toISOString().slice(0, 10)}: métricas por tipo, ubicación exacta y decide() de producción${partial ? " (parcial)" : ""}`;
  return { report, partial, notes };
}

export function recomputeFiles(paths: string[]): string[] {
  const lines: string[] = [];
  for (const given of paths) {
    // Mismas rutas que `compare`: relativas al directorio desde donde se invocó pnpm, no al package
    const path = resolve(process.env.INIT_CWD ?? process.cwd(), given);
    const before = JSON.parse(readFileSync(path, "utf8")) as Report;
    const old = { ...before.metrics };
    const { report, notes } = recomputeReport(JSON.parse(readFileSync(path, "utf8")) as Report);
    writeFileSync(path, JSON.stringify(report, null, 2));
    const m = report.metrics;
    const pct = (v: number | null | undefined) =>
      v === null || v === undefined ? "n/a" : `${Math.round(v * 100)}%`;
    const both = (k: keyof typeof m) =>
      `${pct(old[k] as number | null)} → ${pct(m[k] as number | null)}`;
    lines.push(
      `${report.meta.prompt} × ${report.meta.model}: mae ${old.score_mae?.toFixed(2)} → ${m.score_mae?.toFixed(2)} · blockers_recall ${both("blockers_recall")} · blockers_precision ${both("blockers_precision")} · risks_recall ${both("risks_recall")} · action_acc ${both("action_acc")} · false_apply ${old.false_apply} → ${m.false_apply} · false_discard ${old.false_discard ?? "n/a"} → ${m.false_discard} · location ${both("location_risk_recall")}`,
    );
    for (const n of notes) lines.push(`  nota: ${n}`);
  }
  return lines;
}
