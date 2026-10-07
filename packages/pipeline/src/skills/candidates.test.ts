import { describe, expect, it } from "vitest";
import { skillCandidates } from "./candidates";
import { compileTaxonomy, type SkillTaxonomyEntry } from "./match";

// Taxonomía y avisos inventados: nada de esto viene de datos reales.
const taxonomy: SkillTaxonomyEntry[] = [
  { slug: "python", name: "Python", aliases: [] },
  { slug: "aws", name: "AWS", aliases: ["amazon web services", "lambda"] },
  { slug: "nextjs", name: "Next.js", aliases: ["next"] },
  { slug: "csharp", name: "C#", aliases: [] },
  { slug: "gpt", name: "GPT", aliases: [] },
];

const jdA =
  "Buscamos una persona con experiencia en GraphQL y dbt. Trabajarás con Python, AWS y Next.js. " +
  "Valoramos RAG y GraphQL. Remote team, 5 años de experiencia.";
const jdB =
  "We use GraphQL, dbt and RAG pipelines. Stack: Python, C#, Next.js, Zeta++. " +
  "Our team is remote. Contact the CEO. Experience with GPT-4 is a plus.";
const jdC = "Experiencia con graphql, DBT y Zeta++. Trabajo remote con el team de datos.";

describe("skillCandidates", () => {
  it("devuelve términos técnicos fuera de la taxonomía, por frecuencia", () => {
    const out = skillCandidates([jdA, jdB, jdC], taxonomy);
    expect(out.map((c) => [c.term, c.count])).toEqual([
      ["GraphQL", 4],
      ["dbt", 3],
      ["RAG", 2],
      ["Zeta++", 2],
    ]);
  });

  it("excluye lo que ya matchea la taxonomía (incluido GPT-4 por GPT, Next.js y C#)", () => {
    const terms = skillCandidates([jdA, jdB, jdC], compileTaxonomy(taxonomy)).map((c) => c.term);
    for (const known of ["Python", "AWS", "Next.js", "C#", "GPT-4"]) {
      expect(terms).not.toContain(known);
    }
  });

  it("excluye palabras comunes de avisos y siglas de ruido", () => {
    const terms = skillCandidates(
      ["Remote Team CEO CEO. Experiencia remote.", "CEO Team remote Experience."],
      taxonomy,
    ).map((c) => c.term);
    expect(terms).toEqual([]);
  });

  it("exige un mínimo de apariciones (2 por defecto, configurable)", () => {
    const texts = ["Usamos HTMX y OAuth.", "Usamos HTMX."];
    expect(skillCandidates(texts, []).map((c) => c.term)).toEqual(["HTMX"]);
    expect(skillCandidates(texts, [], { minCount: 1 }).map((c) => c.term)).toEqual([
      "HTMX",
      "OAuth",
    ]);
  });

  it("detecta sufijos .js/.net, #, ++ y números", () => {
    const texts = ["Svelte.js, F#, ASP.NET y Llama3.", "svelte.js, f#, asp.net, llama3"];
    const terms = skillCandidates(texts, []).map((c) => c.term);
    expect(terms).toEqual(["ASP.NET", "F#", "Llama3", "Svelte.js"]);
  });

  it("agrupa variantes de mayúsculas y plurales de siglas, y las lista como ejemplos", () => {
    const out = skillCandidates(["Usamos LLMs y LLM.", "Experiencia en llm."], []);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ term: "LLM", count: 3 });
    expect(out[0]!.examples).toEqual(["LLM", "llm"]);
  });

  it("arma bigramas de términos técnicos consecutivos", () => {
    const texts = ["Usamos LangGraph PyTorch en producción.", "LangGraph PyTorch otra vez."];
    const terms = skillCandidates(texts, []).map((c) => c.term);
    expect(terms).toEqual(["LangGraph", "LangGraph PyTorch", "PyTorch"]);
  });

  it("descarta siglas de 2 letras, palabras con tilde y encabezados comunes", () => {
    const texts = [
      "IA, CI y CD. JD: Inglés avanzado. Serán 164 puestos. SER parte. REQUISITOS: PyTorch.",
      "IA, CI y CD. JD: Inglés avanzado. Serán 164 puestos. SER parte. REQUISITOS: PyTorch.",
    ];
    expect(skillCandidates(texts, []).map((c) => c.term)).toEqual(["PyTorch"]);
  });

  it("deja pasar las tecnologías de 2 letras de la lista corta (S3, D3)", () => {
    const texts = ["Usamos S3 y D3.", "Usamos S3 y D3."];
    expect(skillCandidates(texts, []).map((c) => c.term)).toEqual(["D3", "S3"]);
  });

  it("no arma bigramas con stopwords ni con números sueltos", () => {
    const texts = ["en 164 PyTorch the LangGraph", "en 164 PyTorch the LangGraph"];
    const terms = skillCandidates(texts, []).map((c) => c.term);
    expect(terms).toEqual(["LangGraph", "PyTorch"]);
  });

  it("excluye nombres de empresa (sin mayúsculas ni acentos, y por partes)", () => {
    const texts = [
      "En ZetaWorks Labs usamos PyTorch. Somos NovaTéc y TRX.",
      "ZetaWorks Labs, NOVATEC, TRX Group. PyTorch.",
    ];
    const all = skillCandidates(texts, []).map((c) => c.term);
    expect(all).toEqual(expect.arrayContaining(["ZetaWorks", "PyTorch", "TRX"]));
    const filtered = skillCandidates(texts, [], {
      exclude: ["zetaworks labs", "NovaTéc", "TRX Group"],
    }).map((c) => c.term);
    expect(filtered).toEqual(["PyTorch"]);
  });

  it("excluye también el bigrama que contiene la empresa", () => {
    const texts = ["PyTorch ZetaWorks", "PyTorch ZetaWorks"];
    expect(skillCandidates(texts, [], { exclude: ["ZetaWorks"] }).map((c) => c.term)).toEqual([
      "PyTorch",
    ]);
  });

  it("descarta IDs de tracking: más de 30 caracteres o letras y dígitos mezclados de 13+", () => {
    const longId = "aB3dE5gH7jK9mN1pQ3sT5vX7zA9cD1eF3gH5";
    const mixed = "xK9fL2mQ8rT4vB";
    const texts = [`ref=${longId} id ${mixed} PyTorch`, `ref=${longId} id ${mixed} PyTorch`];
    expect(skillCandidates(texts, []).map((c) => c.term)).toEqual(["PyTorch"]);
  });

  it("es determinista: mismo resultado sin importar el orden de los textos", () => {
    const a = skillCandidates([jdA, jdB, jdC], taxonomy);
    const b = skillCandidates([jdC, jdB, jdA], taxonomy);
    expect(b).toEqual(a);
  });

  it("respeta el límite y tolera entradas vacías", () => {
    expect(skillCandidates([], taxonomy)).toEqual([]);
    expect(skillCandidates(["", "   "], taxonomy)).toEqual([]);
    expect(skillCandidates([jdA, jdB, jdC], taxonomy, { limit: 2 })).toHaveLength(2);
  });
});
