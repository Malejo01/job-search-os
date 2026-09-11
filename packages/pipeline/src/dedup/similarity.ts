import { foldText } from "../normalize/text";

/** Jaccard sobre conjuntos (los repetidos no cuentan). Vacíos → 0. */
export function jaccard(a: readonly string[], b: readonly string[]): number {
  const A = new Set(a);
  const B = new Set(b);
  if (!A.size && !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

/** Palabras normalizadas (minúsculas, sin acentos ni puntuación). */
export function words(text: string): string[] {
  return foldText(text)
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/** n-gramas de palabras, únicos, en orden. Texto más corto que n → un único shingle. */
export function shingles(text: string, n = 5): string[] {
  const w = words(text);
  if (!w.length) return [];
  if (w.length <= n) return [w.join(" ")];
  const out = new Set<string>();
  for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(" "));
  return [...out];
}

/** FNV-1a 32 bits: hash estable entre corridas y entornos (no criptográfico). */
export function fnv1a(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export const SKETCH_SIZE = 512;

/**
 * Sketch bottom-k de los shingles de una JD: los k hashes más chicos, como hex de 8 dígitos
 * ordenados. Es lo que se guarda en `jobs.jd_shingles`. Con ≤ k shingles es el conjunto completo.
 */
export function textShingles(text: string, n = 5, k = SKETCH_SIZE): string[] {
  const hashes = [...new Set(shingles(text, n).map(fnv1a))].sort((a, b) => a - b).slice(0, k);
  return hashes.map((h) => h.toString(16).padStart(8, "0"));
}

/**
 * Similitud Jaccard estimada entre dos sketches bottom-k (estimador estándar: bottom-k de la
 * unión, fracción presente en ambos). Con sketches completos es el Jaccard exacto.
 */
export function shingleSimilarity(
  a: readonly string[],
  b: readonly string[],
  k = SKETCH_SIZE,
): number {
  if (!a.length || !b.length) return 0;
  const A = new Set(a);
  const B = new Set(b);
  const union = [...new Set([...a, ...b])].sort().slice(0, k);
  if (!union.length) return 0;
  let both = 0;
  for (const h of union) if (A.has(h) && B.has(h)) both++;
  return both / union.length;
}
