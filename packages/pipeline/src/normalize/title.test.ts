import { describe, expect, it } from "vitest";
import golden from "../../../../evals/fixtures/golden.json";
import { normalizeTitle, titleTokens } from "./title";

/** Expectativa escrita a mano para cada título del golden (id → tokens normalizados). */
const expectedByGoldenId: Record<number, string> = {
  1: "ai developer llm engineer orchestration layer",
  2: "desarrollador fullstack",
  3: "software engineer",
  4: "fullstack developer angular nodejs",
  5: "project manager",
  6: "fullstack engineer dotnet react",
  7: "fullstack software engineer react python",
  8: "frontend developer react nextjs",
  9: "fullstack engineer",
  10: "ai engineer generative llm",
  11: "ai ml engineer",
  12: "llm engineer",
  13: "lead ai engineer",
  14: "ai platform engineer",
  15: "cxe engineer",
  16: "artificial intelligence engineer",
  17: "ai ml engineering manager",
  18: "tech lead dotnet",
  19: "fullstack developer",
  20: "fullstack programador ia",
  21: "iam engineer sailpoint iiq",
  22: "iam engineer saviynt",
  23: "microsoft teams technical lead",
  24: "ai engineer",
  25: "programa referidos software developer",
  26: "business owner lead activacion cuenta",
  27: "software architect",
  28: "agent architect",
  29: "ai ml engineer",
  30: "ai engineer growth",
  31: "ai engineer sales marketing systems",
  32: "software engineer gtm ai python",
  33: "agentic ai expert",
  34: "ai engineer",
  35: "genai creator",
  36: "software developer",
};

const jaccard = (a: string[], b: string[]) => {
  const A = new Set(a);
  const B = new Set(b);
  const inter = [...A].filter((t) => B.has(t)).length;
  return inter / new Set([...A, ...B]).size;
};

const tituloOf = (id: number) => golden.jobs.find((j) => j.id === id)!.titulo;

describe("normalizeTitle", () => {
  it.each(golden.jobs.map((j) => [j.id, j.titulo] as const))("golden id %i: %s", (id, titulo) => {
    expect(normalizeTitle(titulo)).toBe(expectedByGoldenId[id]);
  });

  it("cubre los 36 jobs del golden", () => {
    expect(Object.keys(expectedByGoldenId)).toHaveLength(36);
  });

  it("titleTokens devuelve tokens únicos en orden de aparición", () => {
    expect(titleTokens("AI Engineer — AI platform")).toEqual(["ai", "engineer", "platform"]);
  });

  it("quita seniority en todas sus formas", () => {
    expect(normalizeTitle("Sr. Backend Developer")).toBe("backend developer");
    expect(normalizeTitle("Backend Developer Ssr")).toBe("backend developer");
    expect(normalizeTitle("Semi Senior Backend Developer")).toBe("backend developer");
    expect(normalizeTitle("Backend Developer Jr")).toBe("backend developer");
    expect(normalizeTitle("Backend Developer III")).toBe("backend developer");
  });

  it("conserva palabras de rol que cambian el puesto (lead, manager, architect)", () => {
    expect(normalizeTitle("Lead AI Engineer")).toBe("lead ai engineer");
    expect(normalizeTitle("Engineering Manager")).toBe("engineering manager");
  });

  it("unifica variantes de full stack / front end / back end", () => {
    for (const t of ["Full Stack Dev", "Full-Stack Dev", "FullStack Dev", "Fullstack Dev"]) {
      expect(normalizeTitle(t)).toBe("fullstack dev");
    }
    expect(normalizeTitle("Front End Dev")).toBe("frontend dev");
    expect(normalizeTitle("Back-end Dev")).toBe("backend dev");
  });

  it("maneja tecnologías con puntuación", () => {
    expect(normalizeTitle(".NET Developer")).toBe("dotnet developer");
    expect(normalizeTitle("C# Developer")).toBe("csharp developer");
    expect(normalizeTitle("C++ Developer")).toBe("cpp developer");
    expect(normalizeTitle("Node.js / Next.JS Developer")).toBe("nodejs nextjs developer");
  });

  it("quita paréntesis anidados, ids de aviso y modalidad", () => {
    expect(normalizeTitle("Agentic AI Expert (LinkedIn: 'AI Engineer (Remote)')")).toBe(
      "agentic ai expert",
    );
    expect(normalizeTitle("AI Engineer ID87374 (Remote)")).toBe("ai engineer");
    expect(normalizeTitle("AI Engineer - Remoto - LATAM")).toBe("ai engineer");
  });

  it("los pares del golden que NO son duplicados quedan con Jaccard de título < 0.6", () => {
    expect(jaccard(titleTokens(tituloOf(6)), titleTokens(tituloOf(7)))).toBeLessThan(0.6);
    expect(jaccard(titleTokens(tituloOf(15)), titleTokens(tituloOf(17)))).toBeLessThan(0.6);
    expect(jaccard(titleTokens(tituloOf(21)), titleTokens(tituloOf(22)))).toBeLessThan(0.6);
  });

  it("dos avisos con el mismo rol y distinto seniority quedan con Jaccard 1", () => {
    expect(jaccard(titleTokens("Senior AI Engineer"), titleTokens("AI Engineer (Sr)"))).toBe(1);
  });
});
