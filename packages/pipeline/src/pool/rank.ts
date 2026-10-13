import type { RoleKey } from "../skills/self-assessment";

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

type WithRole<T> = T & { matchedRole: RoleKey | null };

/**
 * Reparto entre varios puestos (ronda 45). `ranked` ya viene ordenado por `rankCandidates`. Cada
 * candidata va al grupo del primer puesto de `roles` que está en sus `roleHints` (`matchedRole`);
 * las que no matchean ninguno van a un grupo final y conservan `matchedRole: null`. Dentro de cada
 * grupo se mantiene el orden de entrada y los grupos con puesto se intercalan (A, B, A, B...):
 * cuando uno se agota, el otro sigue. Estable y puro. Con un solo puesto, o ninguno, el orden es
 * el de entrada salvo que las sin señal pasan al final.
 */
export function interleaveByRole<T extends { id: string; roleHints: readonly string[] }>(
  ranked: readonly T[],
  roles: readonly RoleKey[],
): WithRole<T>[] {
  const groups = roles.map(() => [] as WithRole<T>[]);
  const rest: WithRole<T>[] = [];
  for (const c of ranked) {
    const i = roles.findIndex((r) => c.roleHints.includes(r));
    if (i === -1) rest.push({ ...c, matchedRole: null });
    else groups[i]!.push({ ...c, matchedRole: roles[i]! });
  }
  const out: WithRole<T>[] = [];
  const longest = Math.max(0, ...groups.map((g) => g.length));
  for (let n = 0; n < longest; n++) {
    for (const g of groups) if (n < g.length) out.push(g[n]!);
  }
  return [...out, ...rest];
}
