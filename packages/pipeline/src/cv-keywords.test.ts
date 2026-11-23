import { describe, expect, it } from "vitest";
import {
  CV_KEYWORDS_FLOOR_DENOMINATOR,
  CV_KEYWORDS_MIN_JOBS,
  CV_KEYWORDS_TOP,
  analyzeCvKeywords,
  normalizeKeywordText,
  type KeywordMarket,
} from "./cv-keywords";

// Mercado inventado: 20 skills ordenadas por demanda
const NAMES = [
  "SQL",
  "Python",
  "Excel",
  "Power BI",
  "Node.js",
  "C++",
  "Machine Learning",
  "Tableau",
  "Git",
  "Docker",
  "AWS",
  "Estadística",
  "ETL",
  "Airflow",
  "Spark",
  "Looker",
  "R",
  "Scala",
  "Kafka",
  "Hadoop",
];
const slug = (n: string) =>
  n
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, "-");

function market(jobs = 120, names = NAMES): KeywordMarket {
  return {
    jobs,
    skills: names.map((name, i) => ({ slug: slug(name), name, mentions: 100 - i })),
  };
}

describe("normalizeKeywordText", () => {
  it("ignora mayúsculas, acentos y signos", () => {
    expect(normalizeKeywordText("  Estadística,  AVANZADA!! ")).toBe("estadistica avanzada");
  });
  it("conserva c++, c# y .net como términos distintos de «c»", () => {
    expect(normalizeKeywordText("C++ y C# con .NET")).toBe("cplusplus y csharp con dotnet");
  });
});

describe("analyzeCvKeywords", () => {
  it("con menos de 20 avisos dice «no_data» y no inventa puntaje", () => {
    const r = analyzeCvKeywords(["SQL y Python"], market(CV_KEYWORDS_MIN_JOBS - 1));
    expect(r).toEqual({ status: "no_data", jobs: CV_KEYWORDS_MIN_JOBS - 1 });
  });

  it("sin skills en el mercado también es «no_data»", () => {
    expect(analyzeCvKeywords(["SQL"], { jobs: 500, skills: [] }).status).toBe("no_data");
  });

  it("mide solo las 15 más pedidas, en orden de demanda", () => {
    const all = NAMES.slice(0, CV_KEYWORDS_TOP).join(", ");
    const r = analyzeCvKeywords([all], market());
    expect(r).toMatchObject({ status: "scored", score: 10, considered: CV_KEYWORDS_TOP });
    // «Kafka» está fuera del top 15: no cuenta ni como faltante
    const r2 = analyzeCvKeywords(["Kafka y Hadoop"], market());
    expect(r2).toMatchObject({ status: "scored", score: 0 });
    if (r2.status === "scored") expect(r2.missing).not.toContain("Kafka");
  });

  it("el puntaje es la proporción cubierta y el consejo trae las 5 que faltan, por demanda", () => {
    // cubre 5 de 15 (SQL, Python, Excel, Power BI, Git)
    const r = analyzeCvKeywords(["Trabajé con SQL, python y EXCEL.", "Power BI; git"], market());
    expect(r.status).toBe("scored");
    if (r.status !== "scored") return;
    expect(r.covered).toEqual(["SQL", "Python", "Excel", "Power BI", "Git"]);
    expect(r.score).toBe(3.3); // 5 / 15 * 10
    expect(r.missing).toEqual(["Node.js", "C++", "Machine Learning", "Tableau", "Docker"]);
  });

  it("no depende de mayúsculas, acentos ni separadores triviales", () => {
    const r = analyzeCvKeywords(
      [
        "ESTADISTICA aplicada",
        "powerbi",
        "nodejs y node js",
        "programé en c++",
        "machine-learning",
      ],
      market(),
    );
    if (r.status !== "scored") throw new Error("debía puntuar");
    expect(r.covered).toEqual(
      expect.arrayContaining(["Estadística", "Power BI", "Node.js", "C++", "Machine Learning"]),
    );
  });

  it("no cuenta coincidencias dentro de otra palabra", () => {
    const r = analyzeCvKeywords(["Gitano de excelencia, ETLs y sqlite"], market());
    if (r.status !== "scored") throw new Error("debía puntuar");
    expect(r.covered).toEqual([]);
  });

  it("«C» o «R» de una letra no se confunden con c++ ni con letras sueltas de otras palabras", () => {
    const r = analyzeCvKeywords(["Armé reportes con rigor en C++"], market(120, ["C++", "R"]));
    if (r.status !== "scored") throw new Error("debía puntuar");
    expect(r.covered).toEqual(["C++"]);
  });

  it("con pocos datos en el mercado el puntaje tiene piso en el denominador", () => {
    const pocas = market(60, ["SQL", "Python"]);
    const r = analyzeCvKeywords(["SQL y Python"], pocas);
    if (r.status !== "scored") throw new Error("debía puntuar");
    expect(r.considered).toBe(2);
    expect(r.score).toBe(Math.round((2 / CV_KEYWORDS_FLOOR_DENOMINATOR) * 100) / 10);
    expect(r.score).toBeLessThan(10);
  });

  it("un CV sin ninguna puntúa 0 y un mercado repetido no duplica skills", () => {
    const dup = market();
    dup.skills = [...dup.skills, ...dup.skills];
    const r = analyzeCvKeywords(["Atención al cliente"], dup);
    if (r.status !== "scored") throw new Error("debía puntuar");
    expect(r.score).toBe(0);
    expect(r.missing).toHaveLength(5);
    expect(new Set(r.missing).size).toBe(5);
  });

  it("ordena por demanda aunque el mercado llegue desordenado", () => {
    const m = market();
    m.skills = [...m.skills].reverse();
    const r = analyzeCvKeywords([""], m);
    if (r.status !== "scored") throw new Error("debía puntuar");
    expect(r.missing).toEqual(["SQL", "Python", "Excel", "Power BI", "Node.js"]);
  });

  it("es determinista y no muta la entrada", () => {
    const m = market();
    const before = JSON.stringify(m);
    expect(analyzeCvKeywords(["SQL"], m)).toEqual(analyzeCvKeywords(["SQL"], m));
    expect(JSON.stringify(m)).toBe(before);
  });

  it("con una entrada de 2 MB responde en menos de 100 ms", () => {
    const huge = ["palabra de relleno ".repeat(110_000)]; // ~2 MB
    const m = market();
    analyzeCvKeywords(huge, m); // calentamiento
    const t0 = performance.now();
    const r = analyzeCvKeywords(huge, m);
    expect(performance.now() - t0).toBeLessThan(100);
    expect(r.status).toBe("scored");
  });
});
