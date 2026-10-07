import { describe, expect, it } from "vitest";
import { normalizeCompany } from "../normalize/company";
import { normalizeTitle, titleTokens } from "../normalize/title";
import { dedup, isGenericCompany, type DedupCandidate, type RecentJob } from "./dedup";
import { textShingles } from "./similarity";

/**
 * Diagnóstico de `posible_duplicado` (ronda 06-B). Casos inventados. Cada describe prueba una
 * hipótesis; donde el comportamiento era un defecto y se arregló, el test lo dice.
 */

const NOW = "2026-03-10T12:00:00Z";
const LONG_JD =
  "Buscamos una persona con experiencia comprobable en servicios y bases de datos. ".repeat(4);

/** Reproduce lo que hace ingest-job.ts al guardar un aviso (jobs.title_normalized + company_raw). */
function stored(id: string, company: string, title: string, jd: string | null = null): RecentJob {
  return {
    id,
    externalIds: [],
    companyNormalized: normalizeCompany(company),
    // ingest-job.ts:145 — lo que se lee de la base es title_normalized partido por espacios
    titleTokens: normalizeTitle(title).split(" ").filter(Boolean),
    jdShingles: jd ? textShingles(jd) : null,
    firstSeenAt: NOW,
  };
}

function candidate(company: string, title: string, jd: string | null = null): DedupCandidate {
  return {
    companyNormalized: normalizeCompany(company),
    // ingest-job.ts:250
    titleTokens: titleTokens(title),
    jdShingles: jd ? textShingles(jd) : null,
    seenAt: NOW,
  };
}

const flagged = (c: DedupCandidate, r: RecentJob[]) => {
  const d = dedup(c, r);
  return d.kind === "insert" && Boolean(d.possibleDuplicateOf);
};

describe("H1: tokens distintos en los dos lados (descartada)", () => {
  it.each([
    "Sr. Python Developer (Remote)",
    "Desarrollador/a Full-Stack Jr - Híbrido ID00000",
    "Ingeniero de Software .NET (C#) - LATAM",
    "Senior",
  ])("normalizeTitle(...).split(' ') reproduce titleTokens: %s", (title) => {
    expect(normalizeTitle(title).split(" ").filter(Boolean)).toEqual(titleTokens(title));
  });

  it("el mismo título guardado y recibido da Jaccard 1 y marca", () => {
    const r = stored("a", "Empresa A", "Sr. Python Developer (Remote)");
    expect(dedup(candidate("Empresa A", "Sr. Python Developer (Remote)"), [r])).toMatchObject({
      kind: "insert",
      possibleDuplicateOf: { jobId: "a", similarity: 1 },
    });
  });
});

describe("H2: empresa vacía o genérica (confirmada, arreglada)", () => {
  it("normalizeCompany('') es vacío y avisos sin relación compartían empresa", () => {
    expect(normalizeCompany("")).toBe("");
    expect(normalizeCompany("  (anónima) ")).toBe("");
  });

  it.each([
    "",
    "Confidencial",
    "Empresa confidencial",
    "Importante empresa",
    "Consultora",
    "desconocida",
    "Unknown",
  ])("no marca por empresa+título cuando la empresa es %j", (company) => {
    const r = stored("a", company, "Backend Developer Python");
    expect(flagged(candidate(company, "Backend Developer Python"), [r])).toBe(false);
  });

  it("una empresa con nombre propio sigue marcando", () => {
    const r = stored("a", "Empresa A", "Backend Developer Python");
    expect(flagged(candidate("Empresa A", "Backend Developer Python"), [r])).toBe(true);
  });

  it("isGenericCompany", () => {
    expect(isGenericCompany("")).toBe(true);
    expect(isGenericCompany("empresa confidencial")).toBe(true);
    expect(isGenericCompany("empresa a")).toBe(false);
  });

  it.todo("lista de genéricos más completa (ej. 'Empresa del rubro X'): ver informe");
});

describe("H3: títulos cortos (parcial)", () => {
  const sim = (a: string, b: string) => {
    const d = dedup(candidate("Empresa A", a), [stored("x", "Empresa A", b)]);
    return d.kind === "insert" && d.possibleDuplicateOf ? d.possibleDuplicateOf.similarity : 0;
  };

  it("2 tokens con 1 distinto: 0,33, no marca", () => {
    expect(sim("Desarrollador Python", "Desarrollador Java")).toBe(0);
  });

  it("3 tokens con 1 distinto: 0,5, no marca", () => {
    expect(sim("Backend Developer Python", "Backend Developer Java")).toBe(0);
  });

  it("4 tokens con 1 distinto: 0,6, marca roles distintos", () => {
    expect(sim("Backend Developer Python Django", "Backend Developer Python Flask")).toBeCloseTo(
      0.6,
    );
  });

  it("seniority y modalidad se quitan: 'Sr. ... (Remote)' y 'Jr ...' son idénticos (1,0)", () => {
    expect(sim("Sr. Python Developer (Remote)", "Jr Python Developer")).toBe(1);
  });

  it("subconjunto de 2 sobre 3 tokens: 0,67, marca", () => {
    expect(sim("Backend Developer Python", "Backend Developer")).toBeCloseTo(2 / 3);
  });

  it("un título que queda sin tokens (solo seniority) nunca marca", () => {
    expect(titleTokens("Senior (Remote)")).toEqual([]);
    expect(sim("Senior (Remote)", "Junior")).toBe(0);
  });
});

describe("H4: avisos sin JD, p. ej. alertas por email (confirmada, por diseño)", () => {
  it("sin JD en los dos lados siempre se compara solo el título", () => {
    const r = stored("a", "Empresa A", "Python Developer");
    expect(flagged(candidate("Empresa A", "Python Developer"), [r])).toBe(true);
  });

  it("con JD en un solo lado también: el texto no puede desmentir", () => {
    const r = stored("a", "Empresa A", "Python Developer", LONG_JD);
    expect(flagged(candidate("Empresa A", "Python Developer"), [r])).toBe(true);
  });

  it("con JD distinta en los dos lados el texto desmiente al título", () => {
    const r = stored("a", "Empresa A", "Python Developer", LONG_JD);
    const other =
      "Equipo de datos, pipelines, orquestación, modelado dimensional y calidad de datos en la nube. ".repeat(
        4,
      );
    expect(flagged(candidate("Empresa A", "Python Developer", other), [r])).toBe(false);
  });

  it("la misma oferta reenviada en alertas con otra URL (sin JD) queda marcada, no fusionada", () => {
    const r = {
      ...stored("a", "Empresa A", "Python Developer"),
      canonicalUrl: "https://ejemplo.test/a?t=1",
    };
    const c = {
      ...candidate("Empresa A", "Python Developer"),
      canonicalUrl: "https://ejemplo.test/a?t=2",
    };
    expect(dedup(c, [r])).toMatchObject({ kind: "insert", possibleDuplicateOf: { jobId: "a" } });
  });
});

describe("H5: otras causas", () => {
  it("sufijos 'labs' y 'group' se quitan: empresas distintas colapsan en la misma", () => {
    expect(normalizeCompany("Delta Labs")).toBe(normalizeCompany("Delta Group"));
    const r = stored("a", "Delta Labs", "Backend Developer");
    expect(flagged(candidate("Delta Group", "Backend Developer"), [r])).toBe(true);
  });

  it("fuera de la ventana de 14 días no marca", () => {
    const r = {
      ...stored("a", "Empresa A", "Python Developer"),
      firstSeenAt: "2026-02-01T12:00:00Z",
    };
    expect(flagged(candidate("Empresa A", "Python Developer"), [r])).toBe(false);
  });

  it("un aviso ya marcado sigue siendo candidato a nuevas marcas (cadena)", () => {
    const r = [
      stored("a", "Empresa A", "Python Developer"),
      stored("b", "Empresa A", "Python Developer"),
    ];
    expect(dedup(candidate("Empresa A", "Python Developer"), r)).toMatchObject({
      kind: "insert",
      possibleDuplicateOf: { similarity: 1 },
    });
  });
});
