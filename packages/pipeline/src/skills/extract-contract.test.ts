import { describe, expect, it } from "vitest";
import { extractSkillsOutputSchema, normalizeExtracted } from "./extract-contract";
import { compileTaxonomy, type SkillTaxonomyEntry } from "./match";

// Taxonomía inventada
const taxonomy: SkillTaxonomyEntry[] = [
  { slug: "python", name: "Python", aliases: ["py"] },
  { slug: "aws", name: "AWS", aliases: ["amazon web services", "lambda"] },
  { slug: "azure", name: "Azure", aliases: [] },
];

const item = (over: Record<string, unknown> = {}) => ({
  term: "Python",
  slug: "python",
  category: "lenguaje",
  must: true,
  ...over,
});

describe("extractSkillsOutputSchema", () => {
  it("acepta la forma del contrato", () => {
    expect(
      extractSkillsOutputSchema.safeParse({ skills: [item(), item({ slug: null })] }).success,
    ).toBe(true);
  });

  it("rechaza campos faltantes, tipos erróneos y términos vacíos", () => {
    const bad = [
      {},
      { skills: "python" },
      { skills: [{ term: "Python", slug: "python", category: "lenguaje" }] },
      { skills: [item({ must: "si" })] },
      { skills: [item({ term: "  " })] },
      { skills: [item({ slug: undefined })] },
    ];
    for (const b of bad) expect(extractSkillsOutputSchema.safeParse(b).success).toBe(false);
  });
});

describe("normalizeExtracted", () => {
  it("separa lo conocido (por slug o por alias) de lo propuesto", () => {
    const r = normalizeExtracted(
      {
        skills: [
          item(),
          item({ term: "Amazon Web Services", slug: null, category: "cloud", must: false }),
          item({ term: "GraphQL", slug: "graphql", category: "framework" }),
          item({ term: "dbt", slug: null, category: "datos", must: false }),
        ],
      },
      taxonomy,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.known).toEqual([
      { slug: "python", term: "Python", category: "lenguaje", must: true },
      { slug: "aws", term: "Amazon Web Services", category: "cloud", must: false },
    ]);
    expect(r.value.proposed).toEqual([
      { term: "GraphQL", slugSuggested: "graphql", category: "framework", must: true },
      { term: "dbt", slugSuggested: null, category: "datos", must: false },
    ]);
  });

  it("usa un slug existente aunque el término no matchee, y acepta taxonomía compilada", () => {
    const r = normalizeExtracted(
      { skills: [item({ term: "Lenguaje de scripting", slug: "python" })] },
      compileTaxonomy(taxonomy),
    );
    expect(r.ok && r.value.known.map((k) => k.slug)).toEqual(["python"]);
  });

  it("un conflicto entre slug y término, o un término ambiguo, va a propuestas", () => {
    const r = normalizeExtracted(
      {
        skills: [
          item({ term: "AWS", slug: "azure", category: "cloud" }),
          item({ term: "Python y AWS", slug: null }),
        ],
      },
      taxonomy,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.known).toEqual([]);
    expect(r.value.proposed.map((p) => p.term)).toEqual(["AWS", "Python y AWS"]);
  });

  it("limpia el slug sugerido y no propone nunca un slug de la taxonomía", () => {
    const r = normalizeExtracted(
      { skills: [item({ term: "Vector Search", slug: " Vector-Search! ", category: "datos" })] },
      taxonomy,
    );
    expect(r.ok && r.value.proposed[0]?.slugSuggested).toBe("vector_search");
  });

  it("deduplica y una mención must gana sobre una deseable", () => {
    const r = normalizeExtracted(
      {
        skills: [
          item({ must: false }),
          item({ term: "py" }),
          item({ term: "dbt", slug: null, must: false }),
          item({ term: "DBT", slug: null, must: true }),
        ],
      },
      taxonomy,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.known).toEqual([
      { slug: "python", term: "Python", category: "lenguaje", must: true },
    ]);
    expect(r.value.proposed).toEqual([
      { term: "dbt", slugSuggested: null, category: "lenguaje", must: true },
    ]);
  });

  it("falla cerrado: salida que no valida el schema devuelve ok:false y nada parcial", () => {
    for (const bad of [null, "texto", { skills: [item(), { term: "X" }] }, { skills: [{}] }]) {
      const r = normalizeExtracted(bad, taxonomy);
      expect(r.ok).toBe(false);
    }
  });

  it("no modifica la taxonomía recibida", () => {
    const before = JSON.stringify(taxonomy);
    normalizeExtracted({ skills: [item({ term: "dbt", slug: null })] }, taxonomy);
    expect(JSON.stringify(taxonomy)).toBe(before);
  });
});
