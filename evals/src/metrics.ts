/** Métricas del harness (evals/README.md). Funciones puras sobre filas por oferta. */

/** Contra qué ancla se mide el score: v1 mezcla match y viabilidad; v1.1+ mide match puro. */
export type Anchor = "human_score" | "human_score_match";

export type JobRow = {
  id: number;
  /** Referencia con la definición vieja (score y viabilidad mezclados). */
  human_score: number | null;
  /** Referencia con la definición v1.1 (match puro). */
  human_score_match: number | null;
  /** Bloqueadores con la definición v1.1 (human_blockers del golden). */
  human_blockers: string[];
  /** Bloqueadores como los anotó Mauro originalmente (campo bloqueadores del golden). */
  human_blockers_legacy: string[];
  /** Riesgos con la definición v1.1 (human_risks del golden). */
  human_risks: string[];
  human_discipline: string;
  human_action: string;
  /** location_ok como lo anotó Mauro (mezclaba modalidad). Referencia para v1. */
  human_location_ok: string;
  /** Ubicación pura (definición v1.1). Referencia para v1.1+. */
  human_location_ok_clean: string;
  /** Mediana del score entre corridas; null si todas fallaron. */
  model_score: number | null;
  scores: number[];
  model_blockers: string[];
  /** Riesgos (prompt v1.1+); vacío con v1. */
  model_risks: string[];
  model_discipline: string | null;
  /** Acción recalculada en código con decide(), no la sugerida por el modelo. */
  model_action: string | null;
  model_location_ok: string | null;
  unstable: boolean;
};

export type Metrics = {
  anchor: Anchor;
  n_jobs: number;
  n_scored: number;
  n_failed: number;
  /** MAE contra el ancla del prompt (human_score para v1, human_score_match para v1.1+). */
  score_mae: number | null;
  /** MAE contra cada ancla, siempre, para que la comparación entre versiones sea legible. */
  score_mae_legacy: number | null;
  score_mae_match: number | null;
  /** Bloqueadores humanos (por TIPO: disciplina, años, modalidad...) que el modelo también devolvió. */
  blockers_recall: number | null;
  /** Tipos de bloqueador del modelo que el humano también tenía. "otro" siempre resta. */
  blockers_precision: number | null;
  /** Métrica vieja (indulgente): jobs con bloqueador humano donde el modelo devolvió ≥ 1 bloqueador, del tipo que sea. */
  blockers_recall_any: number | null;
  /** Solo v1.1+: tipos de riesgo humano (sin "salario no publicado") que el modelo también devolvió. */
  risks_recall: number | null;
  /** Métrica vieja (indulgente): jobs con riesgo humano donde el modelo devolvió ≥ 1 riesgo. */
  risks_recall_any: number | null;
  discipline_acc: number | null;
  action_acc: number | null;
  false_apply: number;
  /** Jobs con ubicación humana riesgo o no donde el modelo devolvió EXACTAMENTE el mismo valor. */
  location_risk_recall: number | null;
  /** Métrica vieja (indulgente): riesgo y no valen como equivalentes. */
  location_risk_recall_any: number | null;
  unstable_ratio: number;
};

export const UNSTABLE_RANGE = 1.5;

/**
 * Taxonomía chica de bloqueadores (la lista cerrada del prompt v1.3.1). Recall y precision se
 * miden por TIPO: que el modelo bloquee "por algo" cuando el humano bloqueó "por otra cosa" no
 * cuenta. "otro" = bloqueador fuera de la lista (título, inglés, país...): siempre es un error.
 */
export const BLOCKER_TYPES = [
  "disciplina",
  "anos",
  "modalidad",
  "autorizacion",
  "salario",
  "jornada",
  "otro",
] as const;
export type BlockerType = (typeof BLOCKER_TYPES)[number];

const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

export function classifyBlocker(text: string): BlockerType {
  const t = fold(text);
  if (
    /disciplina|ml engineer|machine learning|evaluaci|ciberseg|data scien|project manag|administraci/.test(
      t,
    )
  )
    return "disciplina";
  if (/\banos\b|\byears?\b|\d\s*\+|experiencia requerid/.test(t)) return "anos";
  if (/presencial|hibrid|modalidad|oficina|on-?site|visitas|relocat/.test(t)) return "modalidad";
  if (/autorizaci|visa|permiso de trabajo|work auth|ciudadan|residen|sponsor/.test(t))
    return "autorizacion";
  if (/salari|sueldo|remuneraci|\busd\b|piso/.test(t)) return "salario";
  if (/jornada|horas|hours/.test(t)) return "jornada";
  return "otro";
}

/** Taxonomía de riesgos. "salario" (no publicado) se excluye de risks_recall: el modelo lo emite casi siempre. */
export const RISK_TYPES = [
  "ubicacion",
  "salario",
  "staffing",
  "candidatos",
  "empresa_desconocida",
  "ingles",
  "otro",
] as const;
export type RiskType = (typeof RISK_TYPES)[number];
export const RISK_TYPES_EXCLUDED_FROM_RECALL: readonly RiskType[] = ["salario"];

export function classifyRisk(text: string): RiskType {
  const t = fold(text);
  if (/pais|latam|ubicaci|location|remoto sin|remote sin|argentina no/.test(t)) return "ubicacion";
  if (/salari|sueldo|remuneraci/.test(t)) return "salario";
  if (/staffing|consultor|agencia|intermediari|outsourc/.test(t)) return "staffing";
  if (/candidat|competencia|postulant|applicant/.test(t)) return "candidatos";
  if (/desconocid|no identificad|sin informacion de la empresa/.test(t))
    return "empresa_desconocida";
  if (/ingles|english|\bb1\b|\bb2\b|\bc1\b/.test(t)) return "ingles";
  return "otro";
}

const typeSet = <T extends string>(items: readonly string[], classify: (s: string) => T) =>
  new Set(items.map(classify));

/** Σ|H∩M| / Σ|H| y Σ|H∩M| / Σ|M| por tipo, sobre todas las filas. */
export function typedMatch<T extends string>(
  rows: readonly { human: readonly string[]; model: readonly string[] }[],
  classify: (s: string) => T,
  exclude: readonly T[] = [],
): { recall: number | null; precision: number | null } {
  let h = 0;
  let mm = 0;
  let hit = 0;
  for (const r of rows) {
    const H = typeSet(r.human, classify);
    const M = typeSet(r.model, classify);
    for (const x of exclude) {
      H.delete(x);
      M.delete(x);
    }
    h += H.size;
    mm += M.size;
    for (const x of H) if (M.has(x)) hit++;
  }
  return { recall: h ? hit / h : null, precision: mm ? hit / mm : null };
}

/** "evaluate_job@v1.1" → 1.1; "evaluate_job@v1.3.1" → 1.3 (el patch no cambia el ancla). */
export function promptVersionNumber(promptRef: string): number {
  const v = promptRef.split("@")[1] ?? "v1";
  const [major = "1", minor = "0"] = v.replace(/^v/, "").split(".");
  return Number(`${major}.${minor}`) || 1;
}

export function anchorFor(promptRef: string): Anchor {
  return promptVersionNumber(promptRef) >= 1.1 ? "human_score_match" : "human_score";
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export function isUnstable(scores: number[]): boolean {
  return scores.length > 1 && Math.max(...scores) - Math.min(...scores) > UNSTABLE_RANGE;
}

/** "aplicar_personalizado" y "aplicar" cuentan como la misma decisión (postularse). */
export const sameAction = (a: string, b: string): boolean => {
  const norm = (x: string) => (x === "aplicar_personalizado" ? "aplicar" : x);
  return norm(a) === norm(b);
};

const ratio = (num: number, den: number): number | null => (den ? num / den : null);

function mae(rows: JobRow[], pick: (r: JobRow) => number | null): number | null {
  const scored = rows.filter((r) => r.model_score !== null && pick(r) !== null);
  if (!scored.length) return null;
  return scored.reduce((acc, r) => acc + Math.abs(r.model_score! - pick(r)!), 0) / scored.length;
}

/** location_ok humano de referencia según el ancla. */
export const anchorLocation = (r: JobRow, anchor: Anchor): string =>
  anchor === "human_score" ? r.human_location_ok : r.human_location_ok_clean;

/** Bloqueadores humanos de referencia según el ancla. */
export const anchorBlockers = (r: JobRow, anchor: Anchor): string[] =>
  anchor === "human_score" ? r.human_blockers_legacy : r.human_blockers;

export function computeMetrics(rows: JobRow[], anchor: Anchor = "human_score"): Metrics {
  const ok = rows.filter((r) => r.model_score !== null);
  const pickAnchor = (r: JobRow) =>
    anchor === "human_score" ? r.human_score : r.human_score_match;
  const scored = ok.filter((r) => pickAnchor(r) !== null);

  const withBlockers = ok.filter((r) => anchorBlockers(r, anchor).length > 0);
  const blockersHit = withBlockers.filter((r) => r.model_blockers.length > 0).length;
  const typedBlockers = typedMatch(
    ok.map((r) => ({ human: anchorBlockers(r, anchor), model: r.model_blockers })),
    classifyBlocker,
  );

  const withRisks = ok.filter((r) => r.human_risks.length > 0);
  const risksHit = withRisks.filter((r) => r.model_risks.length > 0).length;
  const typedRisks = typedMatch(
    ok.map((r) => ({ human: r.human_risks, model: r.model_risks })),
    classifyRisk,
    RISK_TYPES_EXCLUDED_FROM_RECALL,
  );

  const disciplineHit = ok.filter((r) => r.model_discipline === r.human_discipline).length;
  const actionHit = ok.filter((r) => sameAction(r.model_action ?? "", r.human_action)).length;

  const falseApply = ok.filter(
    (r) =>
      pickAnchor(r) !== null &&
      pickAnchor(r)! <= 4 &&
      (r.model_action === "aplicar" || r.model_action === "aplicar_personalizado"),
  ).length;

  // Ubicación humana "riesgo" o "no": el modelo tiene que devolver EL MISMO valor (riesgo deja
  // aplicar, no lo frena: son decisiones distintas). La versión "any" queda como referencia.
  const risky = ok.filter((r) => {
    const h = anchorLocation(r, anchor);
    return h === "riesgo" || h === "no";
  });
  const riskyExact = risky.filter((r) => r.model_location_ok === anchorLocation(r, anchor)).length;
  const riskyAny = risky.filter(
    (r) => r.model_location_ok === "riesgo" || r.model_location_ok === "no",
  ).length;

  return {
    anchor,
    n_jobs: rows.length,
    n_scored: scored.length,
    n_failed: rows.length - ok.length,
    score_mae: mae(ok, pickAnchor),
    score_mae_legacy: mae(ok, (r) => r.human_score),
    score_mae_match: mae(ok, (r) => r.human_score_match),
    blockers_recall: typedBlockers.recall,
    blockers_precision: typedBlockers.precision,
    blockers_recall_any: ratio(blockersHit, withBlockers.length),
    risks_recall: anchor === "human_score" ? null : typedRisks.recall,
    risks_recall_any: anchor === "human_score" ? null : ratio(risksHit, withRisks.length),
    discipline_acc: ratio(disciplineHit, ok.length),
    action_acc: ratio(actionHit, ok.length),
    false_apply: falseApply,
    location_risk_recall: ratio(riskyExact, risky.length),
    location_risk_recall_any: ratio(riskyAny, risky.length),
    unstable_ratio: ratio(ok.filter((r) => r.unstable).length, ok.length) ?? 0,
  };
}

/** Umbrales de aceptación (evals/README.md). */
export function checkThresholds(m: Metrics): { name: string; ok: boolean; value: string }[] {
  const pct = (v: number | null) => (v === null ? "n/a" : `${(v * 100).toFixed(0)}%`);
  const checks = [
    {
      name: "score_mae ≤ 1.0",
      ok: m.score_mae !== null && m.score_mae <= 1,
      value: m.score_mae?.toFixed(2) ?? "n/a",
    },
    { name: "blockers_recall = 100%", ok: m.blockers_recall === 1, value: pct(m.blockers_recall) },
    {
      name: "blockers_precision = 100%",
      ok: m.blockers_precision === 1,
      value: pct(m.blockers_precision),
    },
    {
      name: "discipline_acc ≥ 90%",
      ok: (m.discipline_acc ?? 0) >= 0.9,
      value: pct(m.discipline_acc),
    },
    { name: "action_acc ≥ 85%", ok: (m.action_acc ?? 0) >= 0.85, value: pct(m.action_acc) },
    { name: "false_apply = 0", ok: m.false_apply === 0, value: String(m.false_apply) },
    {
      name: "location_risk_recall = 100%",
      ok: m.location_risk_recall === 1,
      value: pct(m.location_risk_recall),
    },
    { name: "unstable ≤ 10%", ok: m.unstable_ratio <= 0.1, value: pct(m.unstable_ratio) },
  ];
  if (m.anchor === "human_score_match") {
    checks.splice(3, 0, {
      name: "risks_recall = 100%",
      ok: m.risks_recall === 1,
      value: pct(m.risks_recall),
    });
  }
  return checks;
}
