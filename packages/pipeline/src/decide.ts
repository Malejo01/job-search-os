import type { CriteriaRules } from "./criteria";
import type { Evaluation } from "./evaluation";

/**
 * Decisión desde score + bloqueadores + riesgos + umbrales (EVALUATOR_PROMPT §3, prompt v1.1).
 * El LLM sugiere; esto es lo que vale.
 *
 * | condición                                   | acción                 |
 * |---------------------------------------------|------------------------|
 * | bloqueadores_duros no vacío                 | descartar              |
 * | score < guardar                             | descartar              |
 * | riesgos + score ≥ aplicar                   | aplicar (UI muestra el riesgo) |
 * | riesgos + score entre guardar y aplicar     | guardar                |
 * | sin riesgos + score ≥ personalizado         | aplicar_personalizado  |
 * | sin riesgos + score ≥ aplicar               | aplicar                |
 * | sin riesgos + score entre guardar y aplicar | guardar                |
 * | location_ok = "no" (país excluido)          | tope: guardar como máximo, aunque el score sea alto |
 */
export type ActionThresholds = { personalizado: number; aplicar: number; guardar: number };
export type Action = "aplicar_personalizado" | "aplicar" | "guardar" | "descartar";

export const DEFAULT_THRESHOLDS: ActionThresholds = { personalizado: 9, aplicar: 7, guardar: 5 };

export function decideAction(
  score: number,
  bloqueadoresDuros: readonly string[],
  thresholds: ActionThresholds = DEFAULT_THRESHOLDS,
  riesgos: readonly string[] = [],
): Action {
  if (bloqueadoresDuros.length > 0) return "descartar";
  if (score < thresholds.guardar) return "descartar";
  if (riesgos.length > 0) return score >= thresholds.aplicar ? "aplicar" : "guardar";
  if (score >= thresholds.personalizado) return "aplicar_personalizado";
  if (score >= thresholds.aplicar) return "aplicar";
  return "guardar";
}

/** País del candidato explícitamente excluido: nunca llega a "aplicar" sin que el humano lo vea. */
export function applyLocationCap(accion: Action, locationOk: string | null | undefined): Action {
  if (locationOk === "no" && (accion === "aplicar" || accion === "aplicar_personalizado")) {
    return "guardar";
  }
  return accion;
}

/** Contexto verificable con campos estructurados, fuera de lo que dijo el modelo. */
export type DecideContext = {
  /** Cap del prefiltro (título en blocklist con excepción) o null. */
  titleCap?: number | null;
  /** Flags del prefiltro (location_risk, many_candidates...) que se suman a los riesgos. */
  prefilterFlags?: readonly string[];
};

export type Adjustment = { rule: string; delta: number; detail: string };

export type Decision = {
  /** Score del modelo (match puro). */
  scoreModel: number;
  /** Score tras cap y penalizaciones verificables. Es el que se compara con los umbrales. */
  scoreFinal: number;
  bloqueadores: string[];
  riesgos: string[];
  adjustments: Adjustment[];
  accion: Action;
};

const CLOUD = /\b(aws|azure|gcp|google cloud|kubernetes|k8s|eks|terraform)\b/i;
const FLAG_TO_RISK: Record<string, { text: string; already: RegExp }> = {
  location_risk: {
    text: "ubicación con riesgo (país del candidato no listado o LATAM/remote sin países)",
    already: /pa[ií]s|latam|ubicaci/i,
  },
  many_candidates: { text: "muchos candidatos", already: /candidatos/i },
};

const clamp = (n: number) => Math.max(0, Math.min(10, n));

/**
 * decide(): aplica en código lo que se puede verificar con campos estructurados y recalcula
 * la acción. El modelo propone score y listas; acá se corrige lo que no aplicó:
 * - cap de título (prefiltro): el score no supera el cap;
 * - años requeridos ≥ max_years_hard → bloqueador aunque el modelo no lo haya puesto;
 * - años en el rango de penalización (5–7) → −years_penalty;
 * - gap must de cloud/infra → −cloud_must_penalty;
 * - inglés requerido avanzado/nativo → −english_fluent_penalty;
 * - flags del prefiltro (location_risk, many_candidates) y location_ok ≠ ok → riesgos, sin duplicar.
 */
export function decide(
  evaluation: Evaluation,
  rules: CriteriaRules,
  context: DecideContext = {},
): Decision {
  const adjustments: Adjustment[] = [];
  const bloqueadores = [...evaluation.bloqueadores_duros];
  const riesgos = [...evaluation.riesgos];
  let score = evaluation.score;

  if (context.titleCap !== null && context.titleCap !== undefined && score > context.titleCap) {
    adjustments.push({
      rule: "title_cap",
      delta: context.titleCap - score,
      detail: `cap de título ${context.titleCap}`,
    });
    score = context.titleCap;
  }

  const years = evaluation.years_required;
  if (years !== null && years >= rules.max_years_hard) {
    if (!bloqueadores.some((b) => /a[ñn]os|years/i.test(b))) {
      bloqueadores.push(`años requeridos ≥ ${rules.max_years_hard} (${years})`);
    }
  } else if (
    years !== null &&
    years >= rules.years_penalty.from &&
    years <= rules.years_penalty.to
  ) {
    adjustments.push({
      rule: "years_penalty",
      delta: -rules.years_penalty.penalty,
      detail: `${years} años requeridos (${rules.years_penalty.from}–${rules.years_penalty.to})`,
    });
    score -= rules.years_penalty.penalty;
  }

  const cloudMust = evaluation.gaps.find((g) => g.nivel === "must" && CLOUD.test(g.skill));
  if (cloudMust && rules.cloud_must_penalty) {
    adjustments.push({
      rule: "cloud_must_penalty",
      delta: -rules.cloud_must_penalty,
      detail: `must de infraestructura: ${cloudMust.skill}`,
    });
    score -= rules.cloud_must_penalty;
  }

  if (
    (evaluation.ingles_requerido === "avanzado" || evaluation.ingles_requerido === "nativo") &&
    rules.english_fluent_penalty
  ) {
    adjustments.push({
      rule: "english_fluent_penalty",
      delta: -rules.english_fluent_penalty,
      detail: `inglés requerido ${evaluation.ingles_requerido}`,
    });
    score -= rules.english_fluent_penalty;
  }

  for (const flag of context.prefilterFlags ?? []) {
    const risk = FLAG_TO_RISK[flag];
    if (risk && !riesgos.some((r) => risk.already.test(r))) riesgos.push(risk.text);
  }
  if (evaluation.location_ok !== "ok" && !riesgos.some((r) => /pa[ií]s|latam|ubicaci/i.test(r))) {
    riesgos.push(`location_ok = ${evaluation.location_ok}`);
  }

  const scoreFinal = clamp(score);
  const accion = applyLocationCap(
    decideAction(scoreFinal, bloqueadores, rules.thresholds, riesgos),
    evaluation.location_ok,
  );
  return { scoreModel: evaluation.score, scoreFinal, bloqueadores, riesgos, adjustments, accion };
}
