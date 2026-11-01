import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { anchorFor, computeMetrics, splitByAnchorSource, type Metrics } from "./metrics";
import { cutLine } from "./cost-guard";
import type { Report } from "./run";

/** Rutas relativas al directorio desde donde se invocó pnpm (INIT_CWD), no al package. */
export function loadReport(path: string): Report {
  const base = process.env.INIT_CWD ?? process.cwd();
  return JSON.parse(readFileSync(resolve(base, path), "utf8")) as Report;
}

const fmt = (v: number | null | undefined, digits = 2) =>
  v === null || v === undefined ? "n/a" : v.toFixed(digits);
const pct = (v: number | null | undefined) =>
  v === null || v === undefined ? "n/a" : `${(v * 100).toFixed(0)}%`;
const fmtCount = (v: number | null | undefined) => {
  if (v === null || v === undefined) return "n/a";
  return Number.isInteger(v) ? `${v}` : v.toFixed(1);
};

export type Dispersion = {
  mean: number;
  min: number;
  max: number;
  runs: number;
};

/**
 * Calcula la dispersión (media, mínimo, máximo y cantidad de corridas) para una métrica
 * numérica sobre las métricas individuales de cada corrida (JS-081).
 * Devuelve null si el reporte no tiene múltiples corridas (runs ≤ 1 o ausente).
 */
export function metricDispersion(
  report: Report,
  getValue: (m: Metrics) => number | null | undefined,
): Dispersion | null {
  if (!report.metrics_per_run || report.metrics_per_run.length <= 1) return null;
  const values = report.metrics_per_run
    .map(getValue)
    .filter((v): v is number => v !== null && v !== undefined);
  if (!values.length) return null;
  const sum = values.reduce((acc, v) => acc + v, 0);
  return {
    mean: sum / values.length,
    min: Math.min(...values),
    max: Math.max(...values),
    runs: values.length,
  };
}

function metricCell(
  report: Report,
  getValue: (m: Metrics) => number | null | undefined,
  formatter: (v: number | null | undefined) => string,
): string {
  const base = formatter(getValue(report.metrics));
  const disp = metricDispersion(report, getValue);
  if (!disp) return base;
  return `${base} (media ${formatter(disp.mean)}, rango ${formatter(disp.min)}–${formatter(disp.max)})`;
}

/**
 * Tabla explícita de dispersión por corrida con media y rango (JS-081) cuando al menos
 * uno de los reportes comparados posee múltiples corridas.
 */
function runsDispersionSection(a: Report, b: Report, A: string, B: string): string[] {
  const hasA = Boolean(a.metrics_per_run && a.metrics_per_run.length > 1);
  const hasB = Boolean(b.metrics_per_run && b.metrics_per_run.length > 1);
  if (!hasA && !hasB) return [];

  const out = [
    "Métricas por corrida (media y rango):",
    `| métrica | ${A} | ${B} |`,
    "|---|---|---|",
  ];

  const items: {
    name: string;
    get: (m: Metrics) => number | null | undefined;
    fmt: (v: number | null | undefined) => string;
  }[] = [
    { name: "score_mae", get: (m) => m.score_mae, fmt },
    { name: "blockers_recall", get: (m) => m.blockers_recall, fmt: pct },
    { name: "blockers_precision", get: (m) => m.blockers_precision, fmt: pct },
    { name: "risks_recall", get: (m) => m.risks_recall, fmt: pct },
    { name: "discipline_acc", get: (m) => m.discipline_acc, fmt: pct },
    { name: "action_acc", get: (m) => m.action_acc, fmt: pct },
    { name: "false_apply", get: (m) => m.false_apply, fmt: fmtCount },
    { name: "**false_discard**", get: (m) => m.false_discard, fmt: fmtCount },
    { name: "location_risk_recall", get: (m) => m.location_risk_recall, fmt: pct },
    { name: "location_risk_recall_final", get: (m) => m.location_risk_recall_final, fmt: pct },
  ];

  for (const item of items) {
    const dispA = metricDispersion(a, item.get);
    const dispB = metricDispersion(b, item.get);
    const textA = dispA
      ? `media ${item.fmt(dispA.mean)}, rango ${item.fmt(dispA.min)}–${item.fmt(dispA.max)} (${dispA.runs} corridas)`
      : `${item.fmt(item.get(a.metrics))} (${a.meta.runs ?? 1} corrida)`;
    const textB = dispB
      ? `media ${item.fmt(dispB.mean)}, rango ${item.fmt(dispB.min)}–${item.fmt(dispB.max)} (${dispB.runs} corridas)`
      : `${item.fmt(item.get(b.metrics))} (${b.meta.runs ?? 1} corrida)`;
    out.push(`| ${item.name} | ${textA} | ${textB} |`);
  }
  out.push("");
  return out;
}

/**
 * Métricas separadas por origen del ancla (JS-052). Un ancla "assisted" (rúbrica fija revisada por
 * Mauro) es evidencia más débil que una puntuada a mano: si una mejora aparece solo del lado
 * assisted, conviene mirarla dos veces antes de promover.
 */
function byAnchorSource(a: Report, b: Report, A: string, B: string): string[] {
  const sa = splitByAnchorSource(a.jobs);
  const sb = splitByAnchorSource(b.jobs);
  if (!sa.assisted.length && !sb.assisted.length) return [];
  const anchorA = anchorFor(a.meta.prompt);
  const anchorB = anchorFor(b.meta.prompt);
  const floorA = a.metrics.apply_floor ?? undefined;
  const floorB = b.metrics.apply_floor ?? undefined;
  const out = [
    "Por origen del ancla (human = puntuada a mano; assisted = rúbrica fija revisada):",
    `| origen | n | score_mae A→B | false_discard A→B | false_apply A→B | action_acc A→B |`,
    "|---|---|---|---|---|---|",
    `| (A = ${A}) | | | | | |`,
    `| (B = ${B}) | | | | | |`,
  ];
  for (const origen of ["human", "assisted"] as const) {
    const ra = sa[origen];
    const rb = sb[origen];
    if (!ra.length && !rb.length) continue;
    const mA = computeMetrics(ra, anchorA, floorA);
    const mB = computeMetrics(rb, anchorB, floorB);
    out.push(
      `| **${origen}** | ${ra.length} | ${fmt(mA.score_mae)} → ${fmt(mB.score_mae)} | ${mA.false_discard} → ${mB.false_discard} | ${mA.false_apply} → ${mB.false_apply} | ${pct(mA.action_acc)} → ${pct(mB.action_acc)} |`,
    );
  }
  out.push("");
  return out;
}

/** Un reporte sin los campos de JS-067 usa otra definición de false_discard: no se mezcla en silencio. */
export const needsRecompute = (r: Report): boolean =>
  r.metrics.false_discard_total === undefined ||
  r.jobs.some((j) => j.prefilter_discard === undefined);

/** Diff legible entre dos reportes: métricas lado a lado y jobs cuya decisión o score cambió. */
export function compareReports(a: Report, b: Report): string {
  const stale = [a, b].some(needsRecompute);
  const warning = stale
    ? [
        "AVISO: reporte sin recomputar: correr `pnpm evals recompute <reporte>` antes de comparar (false_discard y ubicación usan definiciones distintas).",
        "",
      ]
    : [];
  const A = `${a.meta.prompt} × ${a.meta.model}${a.meta.label ? ` (${a.meta.label})` : ""}`;
  const B = `${b.meta.prompt} × ${b.meta.model}${b.meta.label ? ` (${b.meta.label})` : ""}`;
  const ma = a.metrics;
  const mb = b.metrics;
  const cutWarnings = [a, b].flatMap((r, i) =>
    cutLine(r).map((l) => `${i === 0 ? "A" : "B"}: ${l}`),
  );
  const lines = [
    ...warning,
    ...(cutWarnings.length ? [...cutWarnings, ""] : []),
    `| métrica | ${A} | ${B} |`,
    "|---|---|---|",
    `| ancla del score | ${ma.anchor ?? "human_score"} | ${mb.anchor ?? "human_score"} |`,
    `| score_mae (ancla) | ${metricCell(a, (m) => m.score_mae, fmt)} | ${metricCell(b, (m) => m.score_mae, fmt)} |`,
    `| score_mae vs human_score | ${metricCell(a, (m) => m.score_mae_legacy ?? m.score_mae, fmt)} | ${metricCell(b, (m) => m.score_mae_legacy ?? m.score_mae, fmt)} |`,
    `| score_mae vs human_score_match | ${metricCell(a, (m) => m.score_mae_match, fmt)} | ${metricCell(b, (m) => m.score_mae_match, fmt)} |`,
    `| blockers_recall | ${metricCell(a, (m) => m.blockers_recall, pct)} | ${metricCell(b, (m) => m.blockers_recall, pct)} |`,
    `| blockers_precision | ${metricCell(a, (m) => m.blockers_precision, pct)} | ${metricCell(b, (m) => m.blockers_precision, pct)} |`,
    `| risks_recall | ${metricCell(a, (m) => m.risks_recall, pct)} | ${metricCell(b, (m) => m.risks_recall, pct)} |`,
    `| discipline_acc | ${metricCell(a, (m) => m.discipline_acc, pct)} | ${metricCell(b, (m) => m.discipline_acc, pct)} |`,
    `| action_acc | ${metricCell(a, (m) => m.action_acc, pct)} | ${metricCell(b, (m) => m.action_acc, pct)} |`,
    `| false_apply | ${metricCell(a, (m) => m.false_apply, fmtCount)} | ${metricCell(b, (m) => m.false_apply, fmtCount)} |`,
    `| **false_discard** | ${metricCell(a, (m) => m.false_discard, fmtCount)} | ${metricCell(b, (m) => m.false_discard, fmtCount)} |`,
    `| false_discard_action (informativa) | ${metricCell(a, (m) => m.false_discard_action, fmtCount)} | ${metricCell(b, (m) => m.false_discard_action, fmtCount)} |`,
    `| location_risk_recall | ${metricCell(a, (m) => m.location_risk_recall, pct)} | ${metricCell(b, (m) => m.location_risk_recall, pct)} |`,
    `| location_risk_recall_final (después de decide()) | ${metricCell(a, (m) => m.location_risk_recall_final, pct)} | ${metricCell(b, (m) => m.location_risk_recall_final, pct)} |`,
    `| false_discard_prefilter | ${metricCell(
      a,
      (m) => m.false_discard_prefilter,
      (v) => fmt(v, 0),
    )} | ${metricCell(
      b,
      (m) => m.false_discard_prefilter,
      (v) => fmt(v, 0),
    )} |`,
    `| false_discard_total (modelo + prefiltro) | ${metricCell(
      a,
      (m) => m.false_discard_total,
      (v) => fmt(v, 0),
    )} | ${metricCell(
      b,
      (m) => m.false_discard_total,
      (v) => fmt(v, 0),
    )} |`,
    `| unstable | ${pct(ma.unstable_ratio)} | ${pct(mb.unstable_ratio)} |`,
    ...(ma.injection_resistance || mb.injection_resistance
      ? [
          `| injection_resistance estricta (adversariales, aparte de D-019) | ${pct(ma.injection_resistance?.strict)} | ${pct(mb.injection_resistance?.strict)} |`,
          `| injection_resistance laxa | ${pct(ma.injection_resistance?.lax)} | ${pct(mb.injection_resistance?.lax)} |`,
        ]
      : []),
    `| tokens in/out | ${a.meta.tokens_in}/${a.meta.tokens_out} | ${b.meta.tokens_in}/${b.meta.tokens_out} |`,
    `| costo USD | ${fmt(a.meta.cost_usd, 4)} | ${fmt(b.meta.cost_usd, 4)} |`,
    "",
    ...runsDispersionSection(a, b, A, B),
    ...byAnchorSource(a, b, A, B),
    "Jobs con cambio de acción o |Δscore| ≥ 1 entre reportes (humano = human_score / human_score_match):",
    "| id | empresa | humano | A | B | acción A → B |",
    "|---|---|---|---|---|---|",
  ];
  const byId = new Map(b.jobs.map((j) => [j.id, j]));
  let changed = 0;
  for (const ja of a.jobs) {
    const jb = byId.get(ja.id);
    if (!jb) continue;
    const scoreMoved =
      ja.model_score !== null &&
      jb.model_score !== null &&
      Math.abs(ja.model_score - jb.model_score) >= 1;
    const actionMoved = ja.model_action !== jb.model_action;
    if (!scoreMoved && !actionMoved) continue;
    changed++;
    const human = `${ja.human_score ?? "–"} / ${ja.human_score_match ?? "–"}`;
    lines.push(
      `| ${ja.id} | ${ja.empresa} | ${human} | ${fmt(ja.model_score, 1)} | ${fmt(jb.model_score, 1)} | ${ja.model_action} → ${jb.model_action} |`,
    );
  }
  if (!changed) lines.push("| – | sin cambios | | | | |");
  return lines.join("\n");
}
