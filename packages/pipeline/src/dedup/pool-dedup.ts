import { isGenericCompany } from "./dedup";
import { shingleSimilarity } from "./similarity";

/**
 * Dedup del pool global (ADR-014), sin fusión: las dos filas quedan y la copia apunta a la raíz.
 * Misma regla que ADR-013 salvo que empresa + título parecido no marca nada (en el pool nadie
 * revisa duplicados posibles).
 * 1. Mismo sourceKind + externalId → es la misma fila.
 * 2. Misma canonicalUrl o mismo jdHash → copia. Mismo texto (shingles ≥ umbral) → copia, pero
 *    solo contra filas de la misma empresa normalizada, por costo: el pool tiene miles de filas.
 *    Todo dentro de la ventana de días sobre `firstSeenAt`: también URL y hash. Una copia que
 *    reaparece pasada la ventana entra al pool como fila nueva sin marca; es una decisión
 *    deliberada por ahora, y el dedup por usuario (JS-138) cubre lo que se escape.
 * 3. Si no, nueva.
 * Función pura: recibe las filas recientes, no consulta nada.
 */
export type PoolDedupCandidate = {
  sourceKind: string;
  externalId: string;
  canonicalUrl: string | null;
  jdHash: string | null;
  jdShingles: readonly string[] | null;
  /** normalizeCompany(company_raw) */
  companyNormalized: string;
  seenAt: Date;
};

export type PoolRecent = PoolDedupCandidate & {
  id: string;
  firstSeenAt: Date;
  dedupOfId: string | null;
};

export type PoolDedupDecision =
  | { kind: "same"; id: string }
  | { kind: "copy_of"; id: string; reason: "url" | "jd_hash" | "jd_text"; similarity: number }
  | { kind: "new" };

export type PoolDedupOptions = { windowDays?: number; textThreshold?: number };

const DAY_MS = 24 * 60 * 60 * 1000;

type Match = { row: PoolRecent; reason: "url" | "jd_hash" | "jd_text"; similarity: number };

export function poolDedup(
  c: PoolDedupCandidate,
  recent: readonly PoolRecent[],
  opts: PoolDedupOptions = {},
): PoolDedupDecision {
  const windowMs = (opts.windowDays ?? 14) * DAY_MS;
  const threshold = opts.textThreshold ?? 0.9;

  for (const row of recent) {
    if (row.sourceKind === c.sourceKind && row.externalId === c.externalId) {
      return { kind: "same", id: row.id };
    }
  }

  const canCompareText = !isGenericCompany(c.companyNormalized) && Boolean(c.jdShingles?.length);
  const matches: Match[] = [];
  for (const row of recent) {
    if (Math.abs(c.seenAt.getTime() - row.firstSeenAt.getTime()) > windowMs) continue;
    if (c.canonicalUrl && row.canonicalUrl === c.canonicalUrl) {
      matches.push({ row, reason: "url", similarity: 1 });
    } else if (c.jdHash && row.jdHash === c.jdHash) {
      matches.push({ row, reason: "jd_hash", similarity: 1 });
    } else if (
      canCompareText &&
      row.companyNormalized === c.companyNormalized &&
      row.jdShingles?.length
    ) {
      const similarity = shingleSimilarity(c.jdShingles!, row.jdShingles);
      if (similarity >= threshold) matches.push({ row, reason: "jd_text", similarity });
    }
  }
  if (!matches.length) return { kind: "new" };

  // La más antigua; a igual fecha, la señal más fuerte. La raíz es a lo que ya apunta la fila.
  const best = matches.reduce((a, b) => {
    const diff = a.row.firstSeenAt.getTime() - b.row.firstSeenAt.getTime();
    if (diff !== 0) return diff < 0 ? a : b;
    return b.similarity > a.similarity ? b : a;
  });
  return {
    kind: "copy_of",
    id: best.row.dedupOfId ?? best.row.id,
    reason: best.reason,
    similarity: best.similarity,
  };
}
