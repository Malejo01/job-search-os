import { z } from "zod";
import { err, ok, type Result } from "../result";
import {
  compileTaxonomy,
  extractSkillsFromText,
  type SkillTaxonomyEntry,
  type Term,
} from "./match";

/**
 * Contrato de la tarea LLM `extract_skills` (JS-030). El modelo lista las skills que dice el texto
 * de una JD; el código decide qué es conocido y qué es propuesta. Nada de lo que devuelva el modelo
 * entra solo a la taxonomía: `proposed` es una lista para revisión humana.
 */
export const extractedSkillSchema = z.object({
  /** Cómo aparece en el texto. */
  term: z.string().trim().min(1).max(80),
  /** Slug de la taxonomía si el modelo lo reconoce; null si no. */
  slug: z.string().trim().min(1).max(80).nullable(),
  category: z.string().trim().min(1).max(40),
  /** true solo si el texto lo pide como requisito. */
  must: z.boolean(),
});

export const extractSkillsOutputSchema = z.object({
  skills: z.array(extractedSkillSchema).max(80),
});

export type ExtractSkillsOutput = z.infer<typeof extractSkillsOutputSchema>;

export type KnownExtractedSkill = { slug: string; term: string; category: string; must: boolean };
export type ProposedSkill = {
  term: string;
  /** Slug en snake_case sugerido por el modelo, limpiado; null si no dio ninguno. */
  slugSuggested: string | null;
  category: string;
  must: boolean;
};

export type NormalizedExtraction = { known: KnownExtractedSkill[]; proposed: ProposedSkill[] };

const cleanSlug = (raw: string): string | null =>
  raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || null;

const termKey = (term: string): string => term.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Separa la salida del modelo en conocido (slug existente, o término que matchea UNA skill por
 * alias) y propuesto. Un conflicto entre slug y término, o un término que matchea varias skills,
 * va a propuestas para que lo mire una persona. Falla cerrado: si el schema no valida, ok:false.
 */
export function normalizeExtracted(
  output: unknown,
  taxonomy: readonly SkillTaxonomyEntry[] | readonly Term[],
): Result<NormalizedExtraction, string> {
  const parsed = extractSkillsOutputSchema.safeParse(output);
  if (!parsed.success) {
    return err(`salida de extract_skills inválida: ${parsed.error.issues[0]?.message ?? "schema"}`);
  }
  const terms: readonly Term[] =
    taxonomy.length && "re" in taxonomy[0]!
      ? (taxonomy as readonly Term[])
      : compileTaxonomy(taxonomy as readonly SkillTaxonomyEntry[]);
  const slugs = new Set(terms.map((t) => t.slug));

  const known = new Map<string, KnownExtractedSkill>();
  const proposed = new Map<string, ProposedSkill>();

  for (const raw of parsed.data.skills) {
    const matched = extractSkillsFromText(raw.term, terms);
    const givenExists = raw.slug !== null && slugs.has(raw.slug);
    let slug: string | null = null;
    if (
      givenExists &&
      (matched.length === 0 || (matched.length === 1 && matched[0] === raw.slug))
    ) {
      slug = raw.slug;
    } else if (!givenExists && matched.length === 1) {
      slug = matched[0]!; // sin slug (o inventado) pero el término es un alias conocido
    }

    if (slug !== null) {
      const prev = known.get(slug);
      if (prev) prev.must = prev.must || raw.must;
      else known.set(slug, { slug, term: raw.term, category: raw.category, must: raw.must });
      continue;
    }
    const key = termKey(raw.term);
    const prev = proposed.get(key);
    if (prev) {
      prev.must = prev.must || raw.must;
      continue;
    }
    const suggested = raw.slug === null ? null : cleanSlug(raw.slug);
    proposed.set(key, {
      term: raw.term,
      slugSuggested: suggested !== null && !slugs.has(suggested) ? suggested : null,
      category: raw.category,
      must: raw.must,
    });
  }
  return ok({ known: [...known.values()], proposed: [...proposed.values()] });
}
