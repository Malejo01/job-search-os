import { compileTaxonomy, extractSkillsFromText, type SkillTaxonomyEntry } from "../skills/match";
import { CV_MAX_CANDIDATES } from "./limits";

export type CvCandidate = { slug: string; name: string };

/**
 * Skills de la taxonomía que aparecen literal en el texto, más las de `role_skills` de los puestos
 * tildados si sobra lugar. Tope `CV_MAX_CANDIDATES`, sin repetidos, las del texto primero.
 * Es la lista cerrada que se le da al modelo: lo que no esté acá se descarta en la salida.
 */
export function cvSkillCandidates(
  text: string,
  taxonomy: readonly SkillTaxonomyEntry[],
  roleSkillSlugs: readonly string[],
): CvCandidate[] {
  const byName = new Map(taxonomy.map((e) => [e.slug, e.name]));
  const seen = new Set<string>();
  const out: CvCandidate[] = [];
  const add = (slug: string): void => {
    const name = byName.get(slug);
    if (name === undefined || seen.has(slug) || out.length >= CV_MAX_CANDIDATES) return;
    seen.add(slug);
    out.push({ slug, name });
  };
  for (const slug of extractSkillsFromText(text, compileTaxonomy(taxonomy))) add(slug);
  for (const slug of roleSkillSlugs) add(slug);
  return out;
}
