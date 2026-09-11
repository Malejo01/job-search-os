import { describe, expect, it } from "vitest";
import golden from "../../../../evals/fixtures/golden.json";
import taxonomy from "../../../db/seeds/skills.json";
import {
  compileTaxonomy,
  extractSkillsFromText,
  matchMention,
  matchStack,
  normalizeMention,
} from "./match";

const terms = compileTaxonomy(taxonomy);
const slugsOf = (stack: string[]) =>
  matchStack(stack, terms)
    .mentions.map((m) => m.slug)
    .sort();

describe("matchStack: mapeo determinista del stack a la taxonomía", () => {
  it("normaliza acentos y mayúsculas", () => {
    expect(normalizeMention("  Máquinas de Estado ")).toBe("maquinas de estado");
  });

  it("separa listas con barra y mapea cada parte", () => {
    expect(slugsOf(["Docker/K8s"])).toEqual(["docker", "kubernetes"]);
    expect(slugsOf(["AWS/Azure/GCP"])).toEqual(["aws", "azure", "gcp"]);
    expect(slugsOf(["Python (Django/Flask/FastAPI)"])).toEqual(["python", "python_backend"]);
  });

  it("términos compuestos no duplican el simple (react native ≠ react) y tapan su tramo", () => {
    expect(slugsOf(["React Native"])).toEqual(["react_native"]);
    expect(slugsOf(["Azure OpenAI"])).toEqual(["azure"]);
    expect(slugsOf(["CI/CD"])).toEqual(["ci_cd"]);
    expect(slugsOf(["Node/TS"])).toEqual(["nodejs", "typescript"]);
  });

  it("'deseable' / 'nice' hacen la mención opcional; el default es must; must gana si se repite", () => {
    const r = matchStack(["Vertex/LangChain deseable", "RAG", "Semantic Kernel deseable"], terms);
    const by = Object.fromEntries(r.mentions.map((m) => [m.slug, m.isMust]));
    expect(by).toMatchObject({ gcp: false, langchain: false, rag: true });
    const r2 = matchStack(["LangChain", "LangGraph deseable"], terms);
    expect(r2.mentions).toEqual([{ slug: "langchain", isMust: true, rawMention: "LangChain" }]);
  });

  it("los calificadores no ensucian lo no mapeado", () => {
    const m = matchMention(".NET Core 5+ años", terms);
    expect(m.slugs).toEqual(["dotnet"]);
    expect(m.leftover).toEqual([]);
    const free = matchMention("estadística en muestras chicas", terms);
    expect(free.slugs).toEqual([]);
    expect(free.leftover).toEqual(["estadistica en muestras chicas"]);
  });

  it("entradas reales del golden", () => {
    expect(slugsOf(["OIDC/JWT", "Okta"])).toEqual(["iam"]);
    expect(slugsOf(["LoRA/QLoRA/PEFT", "PyTorch/TensorFlow", "Hugging Face"])).toEqual([
      "fine_tuning",
      "pytorch",
    ]);
    expect(slugsOf(["eval harnesses", "golden datasets", "LLM-as-judge"])).toEqual(["llm_evals"]);
    expect(slugsOf(["Claude Code/Cursor/MCP deseable"])).toEqual(["ai_coding_tools", "mcp"]);
    expect(slugsOf(["SQL/PostgreSQL", "SQL Server"])).toEqual(["sql"]);
  });

  it("cobertura del golden: mapea la gran mayoría de las menciones y lista lo que no", () => {
    const jobs = golden.jobs as { id: number; stack: string[] }[];
    let mentions = 0;
    let mapped = 0;
    const unmapped: string[] = [];
    for (const j of jobs) {
      for (const raw of j.stack) {
        mentions++;
        const m = matchMention(raw, terms);
        if (m.slugs.length) mapped++;
        else unmapped.push(`${j.id}: ${raw}`);
      }
    }
    // Se imprime para revisar a ojo qué queda afuera (texto libre: "gestión de personas", etc.)
    console.log(
      `golden stack: ${mapped}/${mentions} menciones mapeadas; sin mapear:\n  ${unmapped.join("\n  ")}`,
    );
    expect(mapped / mentions).toBeGreaterThanOrEqual(0.75);
  });
});

describe("extractSkillsFromText: skills mencionadas en una JD", () => {
  it("encuentra términos enteros en texto largo sin duplicar el simple dentro del compuesto", () => {
    const jd =
      "Buscamos AI Engineer con RAG y agentes en Python. Deseable AWS (Lambda, Bedrock) y React Native. Trabajamos con Next.js y PostgreSQL; CI/CD con GitHub Actions.";
    const slugs = extractSkillsFromText(jd, terms).sort();
    expect(slugs).toEqual(
      ["agents", "aws", "ci_cd", "nextjs", "python", "rag", "react_native", "sql"].sort(),
    );
  });
});
