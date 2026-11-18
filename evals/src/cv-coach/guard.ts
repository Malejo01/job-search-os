import { CV_COACH_MAX_TURNS, CV_COACH_RESERVE_USD } from "@job-search-os/pipeline";
import { checkEstimate, type EstimateCheck } from "../cost-guard";

/**
 * Guardarraíles de costo del harness del coach (R12-13, plan §5.3). Puro. Mismas reglas que los evals del
 * evaluador (`../cost-guard.ts`, JS-080): sin tarifa no se corre, el estimado sobre el tope aborta siempre y
 * durante la corrida se frena **antes** de la llamada que podría pasar el tope. Dos topes:
 *
 * - por corrida: `--max-usd` (por defecto USD 0,60);
 * - de la tanda: lo acumulado en `llm_calls` con `label = r12` no puede pasar USD 2,50. Lo que queda de la
 *   tanda achica el tope de la corrida.
 *
 * Dentro de una charla, cada turno se paga solo si además queda la reserva de la redacción (`cv_write`): una
 * charla cortada por el tope igual termina con su CV, como en producción (ADR-038 §9).
 */
export const CV_COACH_EVAL_LABEL = "r12";
export const CV_COACH_EVAL_DEFAULT_MAX_USD = 0.6;
export const CV_COACH_EVAL_TANDA_CAP_USD = 2.5;

/** Costo típico por llamada (plan §3, tarifas del seed): para el estimado previo. */
export const CV_COACH_TYPICAL_USD = { review: 0.014, turn: 0.007, write: 0.013 } as const;
/** Turnos típicos de una charla guionada (la persona dice «no tengo» a lo no guionado). */
export const CV_COACH_TYPICAL_TURNS = 12;
/** Máximo por llamada: la reserva del paso (no el promedio). Es lo que se aparta antes de cada llamada. */
export const CV_COACH_STEP_MAX_USD = {
  review: CV_COACH_RESERVE_USD.review,
  turn: CV_COACH_RESERVE_USD.turn,
  write: CV_COACH_RESERVE_USD.write,
} as const;
export type CoachEvalStep = keyof typeof CV_COACH_STEP_MAX_USD;

export type CoachEvalStage = "diagnostico" | "charla";

export type CoachEvalEstimate = { usd: number; calls: number };

/** Estimado previo: conversaciones × (diagnóstico [+ turnos típicos + redacción]). */
export function estimateCoachRun(conversations: number, stage: CoachEvalStage): CoachEvalEstimate {
  const t = CV_COACH_TYPICAL_USD;
  if (stage === "diagnostico") return { usd: conversations * t.review, calls: conversations };
  const turns = Math.min(CV_COACH_TYPICAL_TURNS, CV_COACH_MAX_TURNS);
  return {
    usd: conversations * (t.review + turns * t.turn + t.write),
    calls: conversations * (2 + turns),
  };
}

export type TandaBudget = { ok: true; maxUsd: number } | { ok: false; reason: string };

/** Tope efectivo de la corrida: el menor entre `--max-usd` y lo que le queda a la tanda. */
export function tandaBudget(
  maxUsd: number,
  accumulatedUsd: number,
  tandaCapUsd: number = CV_COACH_EVAL_TANDA_CAP_USD,
): TandaBudget {
  if (!Number.isFinite(maxUsd) || maxUsd <= 0)
    return { ok: false, reason: "--max-usd tiene que ser un número mayor que 0" };
  if (!Number.isFinite(accumulatedUsd) || accumulatedUsd < 0)
    return { ok: false, reason: "no se pudo leer lo gastado por la tanda en llm_calls" };
  const left = tandaCapUsd - accumulatedUsd;
  if (left <= 0) {
    return {
      ok: false,
      reason: `la tanda ya gastó USD ${accumulatedUsd.toFixed(3)} (label ${CV_COACH_EVAL_LABEL}) y el tope es USD ${tandaCapUsd}: no se corre`,
    };
  }
  return { ok: true, maxUsd: Math.min(maxUsd, left) };
}

/** Chequeo previo: estimado contra el tope efectivo (reusa `checkEstimate`). */
export function checkCoachEstimate(estimate: CoachEvalEstimate, maxUsd: number): EstimateCheck {
  return checkEstimate({ usd: estimate.usd, calls: estimate.calls }, maxUsd);
}

export type CoachBudget = {
  /** ¿Se puede pagar este paso? Para un turno, además tiene que quedar la reserva de la redacción. */
  canStart(step: CoachEvalStep, opts?: { keepWrite?: boolean }): boolean;
  /** Costo real de la llamada; `null` (sin tarifa o fallida) cuenta el máximo del paso. */
  finished(step: CoachEvalStep, costUsd: number | null): void;
  spent(): number;
  /** Alguna llamada se dejó de hacer por el tope. */
  cut(): boolean;
};

export function createCoachBudget(maxUsd: number): CoachBudget {
  let spent = 0;
  let cut = false;
  const EPS = 1e-9;
  return {
    canStart(step, opts = {}) {
      const need = CV_COACH_STEP_MAX_USD[step] + (opts.keepWrite ? CV_COACH_STEP_MAX_USD.write : 0);
      const ok = spent + need <= maxUsd + EPS;
      if (!ok) cut = true;
      return ok;
    },
    finished(step, costUsd) {
      spent += costUsd ?? CV_COACH_STEP_MAX_USD[step];
    },
    spent: () => spent,
    cut: () => cut,
  };
}

/** Un presupuesto sin tope, para el modelo de demo y las transcripciones grabadas (no gastan). */
export function unlimitedCoachBudget(): CoachBudget {
  const b = createCoachBudget(Number.POSITIVE_INFINITY);
  return b;
}
