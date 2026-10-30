/**
 * Orden de prioridad de ofertas (N4-4): una sola regla para todas las listas que ordenan por score.
 * Score desc (sin score al final); a igual score, menos bloqueadores duros primero; después menos
 * riesgos. Sin evaluación, bloqueadores y riesgos cuentan 0.
 *
 * Devuelve 0 si empatan: el desempate estable (fecha, id) lo pone quien llama. Las consultas SQL
 * que ordenan en la base (`listJobs`, `getFirstStepsFacts`) repiten esta misma regla.
 */
export type JobPriority = {
  /** Score de la última evaluación; null = sin evaluar (va al final). */
  score: number | null;
  /** Cantidad de `bloqueadores_duros` de la última evaluación. */
  blockers: number;
  /** Cantidad de `riesgos` de la última evaluación. */
  risks: number;
};

/** Comparador para `Array.prototype.sort`: negativo = `a` va antes que `b`. */
export function compareJobPriority(a: JobPriority, b: JobPriority): number {
  if (a.score !== b.score) {
    if (a.score === null) return 1;
    if (b.score === null) return -1;
    return b.score - a.score;
  }
  return a.blockers - b.blockers || a.risks - b.risks;
}
