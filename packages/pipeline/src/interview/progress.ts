/**
 * Evolución de los puntajes de Interview simulación a simulación (R23-02). Función pura y sin modelo: recibe
 * el promedio de cada criterio de cada simulación terminada y devuelve los puntos ordenados con un decimal y
 * el cambio entre la primera y la última. `at` es la fecha de la simulación en milisegundos: solo se usa para
 * ordenar, nunca se lee la hora actual.
 */
export type InterviewProgressInput = {
  id: string;
  at: number;
  clarity: number;
  relevance: number;
  star: number;
};

export type InterviewProgressPoint = {
  id: string;
  at: number;
  clarity: number;
  relevance: number;
  star: number;
  overall: number;
};

export type InterviewProgress = {
  points: InterviewProgressPoint[];
  /** Última menos primera, un decimal y con signo; null con menos de dos simulaciones. */
  change: { clarity: number; relevance: number; star: number } | null;
};

/** Cuántas simulaciones se muestran en la evolución (las más recientes). */
export const INTERVIEW_PROGRESS_MAX_POINTS = 10;

const round1 = (n: number): number => Math.round(n * 10) / 10;

export function buildInterviewProgress(
  sessions: readonly InterviewProgressInput[],
): InterviewProgress {
  const points = [...sessions]
    .sort((x, y) => x.at - y.at)
    .slice(-INTERVIEW_PROGRESS_MAX_POINTS)
    .map((s) => ({
      id: s.id,
      at: s.at,
      clarity: round1(s.clarity),
      relevance: round1(s.relevance),
      star: round1(s.star),
      overall: round1((s.clarity + s.relevance + s.star) / 3),
    }));
  const first = points[0];
  const last = points.at(-1);
  const change =
    first && last && points.length >= 2
      ? {
          clarity: round1(last.clarity - first.clarity),
          relevance: round1(last.relevance - first.relevance),
          star: round1(last.star - first.star),
        }
      : null;
  return { points, change };
}
