import {
  compileTaxonomy,
  extractSkillsOutputSchema,
  normalizeExtracted,
} from "@job-search-os/pipeline";
import { describe, expect, it } from "vitest";
import {
  createDemoExtractLlm,
  decideMode,
  estimateBackfill,
  formatCandidates,
  formatEstimate,
  formatExtraction,
  jdTexts,
  parseArgs,
} from "./candidates-cli";

// Datos inventados: nada de avisos ni empresas reales.
const terms = compileTaxonomy([
  { slug: "python", name: "Python", aliases: [] },
  { slug: "aws", name: "AWS", aliases: ["lambda"] },
]);

describe("parseArgs y decideMode", () => {
  it("lee los flags con sus defaults", () => {
    expect(parseArgs(["--local"])).toEqual({
      local: true,
      llm: false,
      min: 2,
      top: 40,
      userId: null,
    });
    expect(parseArgs(["--local", "--min", "3", "--top", "10", "--llm", "--user", "u-1"])).toEqual({
      local: true,
      llm: true,
      min: 3,
      top: 10,
      userId: "u-1",
    });
    expect(parseArgs(["--min", "abc", "--top", "-4"])).toMatchObject({ min: 2, top: 40 });
  });

  it("sin --local aborta, aunque haya DB_TARGET=local", () => {
    const mode = decideMode(parseArgs([]), { DB_TARGET: "local", LLM_DEMO: "1" });
    expect(mode.kind).toBe("abort");
    expect(decideMode(parseArgs(["--llm"]), { LLM_DEMO: "1" }).kind).toBe("abort");
  });

  it("--llm sin LLM_DEMO=1 solo estima; con demo corre el cliente falso", () => {
    expect(decideMode(parseArgs(["--local"]), {}).kind).toBe("candidates");
    expect(decideMode(parseArgs(["--local", "--llm"]), {}).kind).toBe("llm_estimate");
    expect(decideMode(parseArgs(["--local", "--llm"]), { LLM_DEMO: "0" }).kind).toBe(
      "llm_estimate",
    );
    expect(decideMode(parseArgs(["--local", "--llm"]), { LLM_DEMO: "1" }).kind).toBe("llm_demo");
  });
});

describe("estimado del backfill", () => {
  const routes = [
    { task: "extract_skills", model: "modelo-x", input_usd_per_mtok: 1.5, output_usd_per_mtok: 9 },
  ];

  it("usa la tarifa de model_routing: 2000 in + 300 out por JD", () => {
    const e = estimateBackfill(100, routes)!;
    expect(e.tokensIn).toBe(200_000);
    expect(e.tokensOut).toBe(30_000);
    expect(e.usd).toBeCloseTo(0.57, 5);
    expect(formatEstimate(e).join("\n")).toContain("USD 0.57");
  });

  it("sin tarifa o sin fila lo dice en vez de inventar", () => {
    const sinTarifa = estimateBackfill(10, [
      { task: "extract_skills", model: "m", input_usd_per_mtok: null, output_usd_per_mtok: null },
    ]);
    expect(sinTarifa?.usd).toBeNull();
    expect(estimateBackfill(10, [])).toBeNull();
    expect(formatEstimate(null)[0]).toContain("model_routing");
  });

  it("con las filas reales del seed hay estimado para extract_skills", () => {
    expect(estimateBackfill(70)?.usd).toBeGreaterThan(0);
  });
});

describe("formato de salida", () => {
  it("lista términos con conteo alineado y variantes, sin texto de avisos", () => {
    const lines = formatCandidates(
      [
        { term: "GraphQL", count: 12, examples: ["GraphQL", "graphql"] },
        { term: "dbt", count: 3 },
      ],
      { jdCount: 40, min: 2 },
    );
    expect(lines).toEqual([
      "40 JD con texto · candidatos con al menos 2 apariciones",
      "12  GraphQL  (GraphQL | graphql)",
      " 3  dbt",
    ]);
    expect(formatCandidates([], { jdCount: 0, min: 2 })[1]).toBe("(sin candidatos)");
  });

  it("jdTexts descarta nulos y vacíos", () => {
    expect(jdTexts([{ jdText: null }, { jdText: "  " }, { jdText: " texto " }])).toEqual(["texto"]);
  });
});

describe("cliente falso de extract_skills", () => {
  const jd = "Stack: Python y AWS. También GraphQL, GraphQL y dbt.";

  it("devuelve salida válida: known por taxonomía y proposed por candidatos", async () => {
    const llm = createDemoExtractLlm(terms);
    const r = await llm.generateStructured("extract_skills", extractSkillsOutputSchema, {
      job: jd,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.model).toBe("fake");
    expect(r.value.costUsd).toBe(0);
    const n = normalizeExtracted(r.value.object, terms);
    expect(n.ok).toBe(true);
    if (!n.ok) return;
    expect(n.value.known.map((k) => k.slug).sort()).toEqual(["aws", "python"]);
    expect(n.value.proposed.map((p) => p.term).sort()).toEqual(["GraphQL", "dbt"]);
    expect(formatExtraction(1, n)).toBe("JD 1: known [python, aws] · proposed [GraphQL, dbt]");
  });

  it("rechaza otras tareas", async () => {
    const r = await createDemoExtractLlm(terms).generateStructured(
      "evaluate_job",
      extractSkillsOutputSchema,
      {},
    );
    expect(r.ok).toBe(false);
  });
});
