import { INTERVIEW_QUESTION_COUNT } from "./schemas";

/** Tope de simulaciones que una persona puede empezar en 24 horas. Lo hace cumplir el código, no el modelo. */
export const INTERVIEW_MAX_SIMULATIONS_PER_DAY = 2;

export type InterviewStartDecision =
  { ok: true; left: number } | { ok: false; reason: "daily_limit" };

/** `startedLast24h`: simulaciones que la persona ya empezó (o tiene en curso) en las últimas 24 horas. */
export function decideInterviewStart(startedLast24h: number): InterviewStartDecision {
  if (startedLast24h >= INTERVIEW_MAX_SIMULATIONS_PER_DAY) {
    return { ok: false, reason: "daily_limit" };
  }
  return { ok: true, left: INTERVIEW_MAX_SIMULATIONS_PER_DAY - startedLast24h };
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
