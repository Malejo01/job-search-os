import { readCap, type CapEnv } from "../cap-env";
import { INTERVIEW_QUESTION_COUNT } from "./schemas";

/**
 * Tope de simulaciones que una persona puede empezar en 24 horas (default). Lo hace cumplir el código, no el
 * modelo. Se puede operar con `INTERVIEW_MAX_SIMULATIONS_PER_DAY` (entero positivo; inválido = este valor).
 */
export const INTERVIEW_MAX_SIMULATIONS_PER_DAY = 2;

export function interviewMaxSimulationsPerDay(env: CapEnv): number {
  return readCap(env, "INTERVIEW_MAX_SIMULATIONS_PER_DAY", INTERVIEW_MAX_SIMULATIONS_PER_DAY, {
    kind: "int",
  });
}

export type InterviewStartDecision =
  { ok: true; left: number } | { ok: false; reason: "daily_limit" };

/** `startedLast24h`: simulaciones que la persona ya empezó (o tiene en curso) en las últimas 24 horas. */
export function decideInterviewStart(
  startedLast24h: number,
  maxPerDay: number = INTERVIEW_MAX_SIMULATIONS_PER_DAY,
): InterviewStartDecision {
  if (startedLast24h >= maxPerDay) {
    return { ok: false, reason: "daily_limit" };
  }
  return { ok: true, left: maxPerDay - startedLast24h };
}

/**
 * Cuándo se libera un cupo: `startedAt` son los inicios de las simulaciones de las últimas 24 horas (borradas
 * incluidas). Sin cupo, vuelve 24 horas después del inicio que tiene que vencer para quedar por debajo del tope;
 * con cupo, `null`. Pura: no lee la hora actual.
 */
export function interviewNextSlotAt(
  startedAt: readonly Date[],
  maxPerDay: number = INTERVIEW_MAX_SIMULATIONS_PER_DAY,
): Date | null {
  if (startedAt.length < maxPerDay) return null;
  const sorted = [...startedAt].sort((a, b) => a.getTime() - b.getTime());
  const mustExpire = sorted[sorted.length - maxPerDay];
  return mustExpire ? new Date(mustExpire.getTime() + 24 * 60 * 60 * 1000) : null;
}

/** «Pregunta N de 5»: `answered` es la cantidad de respuestas ya evaluadas. */
export function interviewProgress(answered: number): {
  current: number;
  total: number;
  done: boolean;
} {
  const done = answered >= INTERVIEW_QUESTION_COUNT;
  return {
    current: done ? INTERVIEW_QUESTION_COUNT : Math.max(0, answered) + 1,
    total: INTERVIEW_QUESTION_COUNT,
    done,
  };
}

export type InterviewScoreLevel = "high" | "mid" | "low" | "far";

/** Nivel de un puntaje de 0 a 10. La web lo traduce a una palabra con `textos-rediseno.ts`. */
export function interviewScoreLevel(score: number): InterviewScoreLevel {
  if (score >= 8) return "high";
  if (score >= 6) return "mid";
  if (score >= 4) return "low";
  return "far";
}

/** Promedio de los tres criterios de todas las respuestas, con un decimal; null sin respuestas. */
export function interviewAverage(
  answers: readonly { clarity: number; relevance: number; star: number }[],
): number | null {
  if (answers.length === 0) return null;
  const total = answers.reduce((t, a) => t + a.clarity + a.relevance + a.star, 0);
  return Math.round((total / (answers.length * 3)) * 10) / 10;
}
