import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { anchorFor, computeMetrics, splitByAnchorSource } from "./metrics";
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

/** Diff legible entre dos reportes: métricas lado a lado y jobs cuya decisión o score cambió. */
export function compareReports(a: Report, b: Report): string {
  const A = `${a.meta.prompt} × ${a.meta.model}${a.meta.label ? ` (${a.meta.label})` : ""}`;
  const B = `${b.meta.prompt} × ${b.meta.model}${b.meta.label ? ` (${b.meta.label})` : ""}`;
  const ma = a.metrics;
  const mb = b.metrics;
  const lines = [
    `| métrica | ${A} | ${B} |`,
    "|---|---|---|",
    `| ancla del score | ${ma.anchor ?? "human_score"} | ${mb.anchor ?? "human_score"} |`,
    `| score_mae (ancla) | ${fmt(ma.score_mae)} | ${fmt(mb.score_mae)} |`,
    `| score_mae vs human_score | ${fmt(ma.score_mae_legacy ?? ma.score_mae)} | ${fmt(mb.score_mae_legacy ?? mb.score_mae)} |`,
    `| score_mae vs human_score_match | ${fmt(ma.score_mae_match)} | ${fmt(mb.score_mae_match)} |`,
    `| blockers_recall | ${pct(ma.blockers_recall)} | ${pct(mb.blockers_recall)} |`,
    `| blockers_precision | ${pct(ma.blockers_precision)} | ${pct(mb.blockers_precision)} |`,
    `| risks_recall | ${pct(ma.risks_recall)} | ${pct(mb.risks_recall)} |`,
    `| discipline_acc | ${pct(ma.discipline_acc)} | ${pct(mb.discipline_acc)} |`,
    `| action_acc | ${pct(ma.action_acc)} | ${pct(mb.action_acc)} |`,
    `| false_apply | ${ma.false_apply} | ${mb.false_apply} |`,
    `| **false_discard** | ${ma.false_discard} | ${mb.false_discard} |`,
    `| false_discard_action (informativa) | ${ma.false_discard_action} | ${mb.false_discard_action} |`,
    `| location_risk_recall | ${pct(ma.location_risk_recall)} | ${pct(mb.location_risk_recall)} |`,
    `| unstable | ${pct(ma.unstable_ratio)} | ${pct(mb.unstable_ratio)} |`,
    `| tokens in/out | ${a.meta.tokens_in}/${a.meta.tokens_out} | ${b.meta.tokens_in}/${b.meta.tokens_out} |`,
    `| costo USD | ${fmt(a.meta.cost_usd, 4)} | ${fmt(b.meta.cost_usd, 4)} |`,
    "",
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
