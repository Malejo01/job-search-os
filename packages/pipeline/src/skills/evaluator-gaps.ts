import { matchMention, type Term } from "./match";

/** Tope de largo de cada gap antes del matcher: es salida del modelo y no se le cree el tamaño. */
const MAX_GAP_CHARS = 300;

/**
 * «El evaluador te la marcó en G ofertas» (diseño 121, E4d). Los gaps son texto del modelo: acá solo
 * pasan por el matcher de la taxonomía y salen slugs, nunca se muestran. Una skill cuenta una vez
 * por evaluación aunque aparezca en varios gaps. Es un dato al lado del simulador: no entra en «+K».
 */
export function countGapMentions(
  gapLists: readonly (readonly string[])[],
  terms: readonly Term[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const gaps of gapLists) {
    const seen = new Set<string>();
    for (const gap of gaps) {
      const text = String(gap ?? "").slice(0, MAX_GAP_CHARS);
      if (!text.trim()) continue;
      for (const slug of matchMention(text, terms).slugs) seen.add(slug);
    }
    for (const slug of seen) counts.set(slug, (counts.get(slug) ?? 0) + 1);
  }
  return counts;
}
