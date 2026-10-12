export type RankCandidate = {
  id: string;
  /** El rol del usuario está entre los `role_hints` del aviso. */
  exactRole: boolean;
  /** Pre-score determinista (0 a 10). */
  score: number;
  postedAt: Date | null;
};

/**
 * Orden de asignación: rol exacto primero, después score desc, después fecha de publicación desc
 * (sin fecha al final) y, para que el resultado no dependa del orden de entrada, id asc.
 * Devuelve una copia; no muta la entrada.
 */
export function rankCandidates<T extends RankCandidate>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    if (a.exactRole !== b.exactRole) return a.exactRole ? -1 : 1;
    if (a.score !== b.score) return b.score - a.score;
    const ta = a.postedAt?.getTime() ?? null;
    const tb = b.postedAt?.getTime() ?? null;
    if (ta !== tb) {
      if (ta === null) return 1;
      if (tb === null) return -1;
      return tb - ta;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}
