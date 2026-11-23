import { err, ok, type Result } from "../result";
import { interviewScoreLevel, type InterviewScoreLevel } from "./limits";

/**
 * Informe al terminar una simulación (R23-01). Función pura y sin modelo: promedios por criterio, mejor y más
 * floja respuesta, y los consejos más repetidos. Los consejos son texto libre del modelo, así que no se
 * comparan palabras: cada respuesta se clasifica por el criterio donde sacó menos (su «código») y se agrupa
 * por ese código. Es una regla fija y explicable, no una interpretación.
 */
export type InterviewCriterion = "clarity" | "relevance" | "star";

export type InterviewReportAnswer = {
  position: number;
  clarity: number;
  relevance: number;
  star: number;
  tip: string;
};

export type InterviewReport = {
  count: number;
  /** Promedio de los tres criterios de todas las respuestas, un decimal. */
  overall: number;
  averages: Record<InterviewCriterion, { value: number; level: InterviewScoreLevel }>;
  best: { position: number; average: number };
  /** null con una sola respuesta: no hay una «más floja» que no sea también la mejor. */
  worst: { position: number; average: number } | null;
  tipGroups: {
    code: InterviewCriterion;
    count: number;
    /** Consejo de la respuesta más floja del grupo en ese criterio. */
    tip: string;
    positions: number[];
  }[];
};

/** Orden de los criterios en pantalla y desempate entre grupos con la misma cantidad. */
const DISPLAY_ORDER: readonly InterviewCriterion[] = ["clarity", "relevance", "star"];
/** Si una respuesta empata en su criterio más flojo, manda la estructura: es lo más fácil de practicar. */
const WEAKEST_TIE_ORDER: readonly InterviewCriterion[] = ["star", "relevance", "clarity"];
const MAX_TIP_GROUPS = 3;

const round1 = (n: number): number => Math.round(n * 10) / 10;

function weakestCriterion(a: InterviewReportAnswer): InterviewCriterion {
  let weakest = WEAKEST_TIE_ORDER[0]!;
  for (const c of WEAKEST_TIE_ORDER) if (a[c] < a[weakest]) weakest = c;
  return weakest;
}

export function buildInterviewReport(
  answers: readonly InterviewReportAnswer[],
): Result<InterviewReport, "no_answers"> {
  if (answers.length === 0) return err("no_answers");
  // Copia ordenada por pregunta: así los desempates no dependen del orden de entrada
  const sorted = [...answers].sort((x, y) => x.position - y.position);
  const n = sorted.length;

  const avg = (c: InterviewCriterion): number => round1(sorted.reduce((t, a) => t + a[c], 0) / n);
  const averages = {
    clarity: { value: avg("clarity"), level: interviewScoreLevel(avg("clarity")) },
    relevance: { value: avg("relevance"), level: interviewScoreLevel(avg("relevance")) },
    star: { value: avg("star"), level: interviewScoreLevel(avg("star")) },
  };
  const overall = round1(
    sorted.reduce((t, a) => t + a.clarity + a.relevance + a.star, 0) / (n * 3),
  );

  const perAnswer = sorted.map((a) => ({
    position: a.position,
    raw: (a.clarity + a.relevance + a.star) / 3,
  }));
  let best = perAnswer[0]!;
  let worst = perAnswer[0]!;
  for (const p of perAnswer) {
    if (p.raw > best.raw) best = p;
    if (p.raw < worst.raw) worst = p;
  }

  const groups = new Map<InterviewCriterion, InterviewReportAnswer[]>();
  for (const a of sorted) {
    const code = weakestCriterion(a);
    groups.set(code, [...(groups.get(code) ?? []), a]);
  }
  const tipGroups = [...groups.entries()]
    .map(([code, members]) => {
      const weakest = members.reduce((m, a) => (a[code] < m[code] ? a : m));
      return {
        code,
        count: members.length,
        tip: weakest.tip,
        positions: members.map((m) => m.position),
      };
    })
    .sort(
      (x, y) => y.count - x.count || DISPLAY_ORDER.indexOf(x.code) - DISPLAY_ORDER.indexOf(y.code),
    )
    .slice(0, MAX_TIP_GROUPS);

  return ok({
    count: n,
    overall,
    averages,
    best: { position: best.position, average: round1(best.raw) },
    worst: n > 1 ? { position: worst.position, average: round1(worst.raw) } : null,
    tipGroups,
  });
}
