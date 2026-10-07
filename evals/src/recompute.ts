import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Evaluation } from "@job-search-os/pipeline";
import { criteriaHash, criteriaRules, goldenJobs, type GoldenJob } from "./golden";
import {
  anchorFor,
  checkThresholds,
  computeMetrics,
  decisionSignals,
  splitByAnchorSource,
  type Metrics,
} from "./metrics";
import { productionDecision, type JobReport, type Report } from "./run";

/**
 * Recalcula métricas y acción de un reporte guardado SIN llamar a la API. Usa la salida cruda
 * (`model_raw`) si el reporte la tiene; si es anterior a esa columna reconstruye lo que puede
 * desde los campos guardados y deja anotado qué ajustes de decide() no se pudieron aplicar
 * (años requeridos e inglés: el reporte viejo no los guardaba).
 *
 * Las anclas humanas se releen del golden actual (JS-064): si cambiaron desde la corrida, se
 * avisa cada una. `anclasDelReporte` reproduce el cálculo viejo, con las anclas guardadas.
 */
export type RecomputeResult = { report: Report; partial: boolean; notes: string[] };
export type RecomputeOptions = { anclasDelReporte?: boolean };

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

const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Reemplaza en la fila las anclas por las del golden actual y devuelve un aviso por cada una que
 * cambió. Los avisos llevan solo ID, nombre de campo y valores de enum o numéricos: nunca el
 * texto de bloqueadores o riesgos (solo cuántos ítems).
 */
function refreshAnchors(j: JobReport, g: GoldenJob): string[] {
  const notes: string[] = [];
  const scalar = (label: string, before: unknown, after: unknown) => {
    if (before !== after)
      notes.push(`ancla actualizada: id ${j.id}, ${label} ${before} → ${after}`);
  };
  const list = (label: string, before: readonly string[], after: readonly string[]) => {
    if (!sameList(before, after))
      notes.push(
        `ancla actualizada: id ${j.id}, ${label} cambió (${
          before.length === after.length
            ? `${after.length} ítems, texto distinto`
            : `${before.length} → ${after.length} ítems`
        })`,
      );
  };
  const source = g.anchor_source ?? "human";
  scalar("acción", j.human_action, g.accion);
  scalar("human_score", j.human_score, g.human_score);
  scalar("human_score_match", j.human_score_match, g.human_score_match);
  scalar("anchor_source", j.anchor_source ?? "human", source);
  scalar("human_location_ok", j.human_location_ok_clean, g.human_location_ok);
  scalar("location_ok (legado)", j.human_location_ok, g.location_ok);
  scalar("disciplina", j.human_discipline, g.disciplina);
  list("human_blockers", j.human_blockers, g.human_blockers);
  list("bloqueadores (legado)", j.human_blockers_legacy, g.bloqueadores);
  list("human_risks", j.human_risks, g.human_risks);

  j.human_action = g.accion;
  j.human_score = g.human_score;
  j.human_score_match = g.human_score_match;
  j.anchor_source = source;
  j.human_location_ok_clean = g.human_location_ok;
  j.human_location_ok = g.location_ok;
  j.human_discipline = g.disciplina;
  j.human_blockers = g.human_blockers;
  j.human_blockers_legacy = g.bloqueadores;
  j.human_risks = g.human_risks;
  return notes;
}

const ANCHOR_KEYS = [
  "human_score",
  "human_score_match",
  "human_blockers",
  "human_blockers_legacy",
  "human_risks",
  "human_discipline",
  "human_action",
  "anchor_source",
  "human_location_ok",
  "human_location_ok_clean",
] as const;

/**
 * recompute reescribe el reporte: sin guardar las anclas de la corrida la primera vez, un
 * segundo `--anclas-del-reporte` ya no podría reproducir el cálculo viejo.
 */
function snapshotAnchors(report: Report): void {
  if (report.meta.anclas_del_reporte) return;
  report.meta.anclas_del_reporte = Object.fromEntries(
    report.jobs.map((j) => [j.id, Object.fromEntries(ANCHOR_KEYS.map((k) => [k, j[k]]))]),
  );
}

function restoreAnchors(report: Report): void {
  const saved = report.meta.anclas_del_reporte;
  if (!saved) return;
  for (const j of report.jobs) Object.assign(j, saved[j.id] ?? {});
}

export function recomputeReport(report: Report, options: RecomputeOptions = {}): RecomputeResult {
  const anchor = anchorFor(report.meta.prompt);
  const notes: string[] = [];
  let partial = false;
  if (options.anclasDelReporte) restoreAnchors(report);
  else snapshotAnchors(report);
  for (const j of report.jobs) {
    const golden = goldenJobs.find((g) => g.id === j.id);
    if (!golden) {
      notes.push(`job ${j.id} no está en el golden actual: se deja como estaba`);
      continue;
    }
    if (!options.anclasDelReporte) notes.push(...refreshAnchors(j, golden));
    const raw = j.model_raw ?? reconstructRaw(j);
    if (!j.model_raw && raw) partial = true;
    const a = anchor === "human_score" ? j.human_score : j.human_score_match;
    j.delta = j.model_score !== null && a !== null ? j.model_score - a : null;
    const { action, decision } = productionDecision(golden, raw, j.model_score);
    j.model_action = action;
    j.decision = decision;
    j.model_score_final = decision?.score_final ?? null;
    const signals = decisionSignals(decision);
    j.model_location_risk_final = signals.location_risk_final;
    j.prefilter_discard = signals.prefilter_discard;
  }
  if (partial) {
    notes.push(
      "reporte sin model_raw: decide() se aplicó sin years_required ni ingles_requerido (bloqueador por años ≥ 8, penalización 5–7 años e inglés no se pudieron reproducir)",
    );
  }
  const hashNote = criteriaHashNote(report.meta.criteria_hash);
  if (hashNote) notes.push(hashNote);
  report.metrics = computeMetrics(report.jobs, anchor, criteriaRules.thresholds.guardar);
  report.thresholds = checkThresholds(report.metrics);
  const anchors = options.anclasDelReporte ? "anclas del reporte" : "anclas del golden actual";
  report.meta.recomputed = `${new Date().toISOString().slice(0, 10)}: métricas por tipo, ubicación exacta y decide() de producción, ${anchors}${partial ? " (parcial)" : ""}`;
  return { report, partial, notes };
}

/** Aviso sobre el hash de criterios; null si el del reporte coincide con el actual. */
export function criteriaHashNote(reportHash: string | undefined): string | null {
  if (!reportHash) {
    return `criterios: sin hash en el reporte (corrida anterior a JS-067); hash actual ${criteriaHash}, no se puede saber si son los mismos criterios`;
  }
  if (reportHash !== criteriaHash) {
    return `criterios: el hash del reporte (${reportHash}) no coincide con el actual (${criteriaHash}): la acción recalculada usa otros criterios que la corrida`;
  }
  return null;
}

const pct = (v: number | null | undefined) =>
  v === null || v === undefined ? "n/a" : `${Math.round(v * 100)}%`;

/** Resumen de una línea más el desglose; solo números e IDs. */
export function formatRecompute(report: Report, old: Partial<Metrics>, notes: string[]): string[] {
  const m = report.metrics;
  const both = (k: keyof Metrics) =>
    `${pct(old[k] as number | null | undefined)} → ${pct(m[k] as number | null)}`;
  const lines = [
    `${report.meta.prompt} × ${report.meta.model}: mae ${old.score_mae?.toFixed(2)} → ${m.score_mae?.toFixed(2)} · blockers_recall ${both("blockers_recall")} · blockers_precision ${both("blockers_precision")} · risks_recall ${both("risks_recall")} · action_acc ${both("action_acc")} · false_apply ${old.false_apply} → ${m.false_apply} · false_discard ${old.false_discard ?? "n/a"} → ${m.false_discard} · location ${both("location_risk_recall")}`,
    `  laxas: blockers_recall_any ${both("blockers_recall_any")} · risks_recall_any ${both("risks_recall_any")} · location_risk_recall_any ${both("location_risk_recall_any")} · false_discard_action ${old.false_discard_action ?? "n/a"} → ${m.false_discard_action}`,
    `  location_risk_recall cruda ${pct(m.location_risk_recall)} · final (después de decide()) ${pct(m.location_risk_recall_final)}`,
    `  falso descarte del prefiltro (ancla ≥ ${m.apply_floor}): ${m.false_discard_prefilter} (aparte de false_discard del modelo)`,
    `  false_discard_total (modelo + prefiltro, definición vieja) ${old.false_discard ?? "n/a"} → ${m.false_discard_total} · false_discard_action_total ${old.false_discard_action ?? "n/a"} → ${m.false_discard_action_total}`,
  ];
  const types = Object.entries(m.risks_recall_by_type);
  if (types.length) {
    lines.push(
      `  risks_recall por tipo: ${types.map(([t, v]) => `${t} ${pct(v.recall)} (n=${v.n_human})`).join(" · ")}`,
    );
  }
  const anchor = anchorFor(report.meta.prompt);
  const split = splitByAnchorSource(report.jobs);
  for (const origen of ["human", "assisted"] as const) {
    const rows = split[origen];
    if (!rows.length) continue;
    const s = computeMetrics(rows, anchor, m.apply_floor);
    lines.push(
      `  por origen ${origen} (n=${rows.length}): action_acc ${pct(s.action_acc)} · false_apply ${s.false_apply} · false_discard ${s.false_discard} · false_discard_prefilter ${s.false_discard_prefilter}`,
    );
  }
  for (const n of notes) lines.push(`  nota: ${n}`);
  return lines;
}

export function recomputeFiles(paths: string[], options: RecomputeOptions = {}): string[] {
  const lines: string[] = [];
  for (const given of paths) {
    // Mismas rutas que `compare`: relativas al directorio desde donde se invocó pnpm, no al package
    const path = resolve(process.env.INIT_CWD ?? process.cwd(), given);
    const before = JSON.parse(readFileSync(path, "utf8")) as Report;
    const old = { ...before.metrics };
    const { report, notes } = recomputeReport(
      JSON.parse(readFileSync(path, "utf8")) as Report,
      options,
    );
    writeFileSync(path, JSON.stringify(report, null, 2));
    lines.push(...formatRecompute(report, old, notes));
  }
  return lines;
}
