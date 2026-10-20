import { describe, expect, it } from "vitest";
import { buildCareerMarket, SMALL_SAMPLE_JOBS, TOP_SKILLS } from "./career-market";
import { ENGLISH_ESTIMATED } from "./english";
import type { CareerJobInput, CareerMarketInput, CareerSkillInput } from "./types";

const NOW = "2026-10-16T12:00:00.000Z";

function job(id: string, over: Partial<CareerJobInput> = {}): CareerJobInput {
  return {
    id,
    title: "Developer",
    seniority: null,
    lang: null,
    salaryMinUsd: null,
    salaryMaxUsd: null,
    salaryPeriod: null,
    modality: "remoto",
    countriesAllowed: null,
    locationRaw: null,
    sourceKind: "remoteok",
    publishedAt: "2026-10-01T00:00:00.000Z",
    jdText: null,
    ...over,
  };
}

function input(
  jobs: CareerJobInput[],
  skills: CareerSkillInput[] = [],
  over: Partial<CareerMarketInput> = {},
): CareerMarketInput {
  return { role: "frontend", jobs, skills, poolUpdatedAt: NOW, now: NOW, ...over };
}

const many = (n: number) => Array.from({ length: n }, (_, i) => job(`j${i}`));

describe("buildCareerMarket · base", () => {
  it("pool vacío", () => {
    const m = buildCareerMarket(input([], [], { poolUpdatedAt: null }));
    expect(m.total).toBe(0);
    expect(m.smallSample).toBe(true);
    expect(m.skills).toEqual([]);
    expect(m.poolUpdatedAt).toBeNull();
    expect(m.volume).toMatchObject({ active: 0, new24h: 0, sources: [] });
    expect(m.salary).toMatchObject({ informed: 0, total: 0, enough: false });
    expect(m.english.asks).toBe(0);
    expect(m.computedAt).toBe(NOW);
    expect(m.role).toBe("frontend");
  });

  it("muestra chica: 19 sí, 20 no", () => {
    expect(SMALL_SAMPLE_JOBS).toBe(20);
    expect(buildCareerMarket(input(many(19))).smallSample).toBe(true);
    expect(buildCareerMarket(input(many(20))).smallSample).toBe(false);
  });

  it("es JSON plano", () => {
    const m = buildCareerMarket(input(many(3)));
    expect(JSON.parse(JSON.stringify(m))).toEqual(m);
  });
});

describe("buildCareerMarket · skills", () => {
  it("dedup por aviso, must/nice y share", () => {
    const skills: CareerSkillInput[] = [
      { jobId: "a", slug: "react", name: "React", isMust: false },
      { jobId: "a", slug: "react", name: "React", isMust: true },
      { jobId: "b", slug: "react", name: "React", isMust: false },
      { jobId: "b", slug: "css", name: "CSS", isMust: false },
      { jobId: "zzz", slug: "ghost", name: "Ghost", isMust: true },
    ];
    const m = buildCareerMarket(input([job("a"), job("b"), job("c"), job("d")], skills));
    expect(m.skills).toEqual([
      { slug: "react", name: "React", jobs: 2, must: 1, nice: 1, share: 0.5 },
      { slug: "css", name: "CSS", jobs: 1, must: 0, nice: 1, share: 0.25 },
    ]);
  });

  it("top 10", () => {
    expect(TOP_SKILLS).toBe(10);
    const skills = Array.from({ length: 15 }, (_, i) => ({
      jobId: "a",
      slug: `s${String(i).padStart(2, "0")}`,
      name: `S${i}`,
      isMust: false,
    }));
    expect(buildCareerMarket(input([job("a")], skills)).skills).toHaveLength(10);
  });
});

describe("buildCareerMarket · seniority, inglés y sueldos", () => {
  it("cuenta buckets con respaldo en el título", () => {
    const m = buildCareerMarket(
      input([
        job("1", { seniority: "Junior" }),
        job("2", { seniority: "Any", title: "Senior Developer" }),
        job("3"),
      ]),
    );
    expect(m.seniority.counts).toEqual({ junior: 1, semi: 0, senior: 1, lead: 0, unknown: 1 });
  });

  it("inglés: pide, niveles y avisos escritos en inglés", () => {
    const m = buildCareerMarket(
      input([
        job("1", { jdText: "Inglés avanzado (excluyente)" }),
        job("2", { jdText: "Se requiere manejo de inglés" }),
        job("3", { lang: "en" }),
        job("4", { lang: "en", jdText: "Fluent English is a must" }),
      ]),
    );
    expect(m.english.asks).toBe(3);
    expect(m.english.levels).toEqual({
      basico: 0,
      intermedio: 0,
      avanzado: 1,
      fluido: 1,
      sin_nivel: 1,
    });
    expect(m.english.writtenInEnglish).toBe(2);
    expect(m.english.estimated).toBe(ENGLISH_ESTIMATED);
  });

  const withSalary = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      job(`s${i}`, {
        salaryMinUsd: 1000 * (i + 1),
        salaryMaxUsd: 1000 * (i + 1),
        salaryPeriod: "mensual",
      }),
    );

  it("sueldos con N = 9: sin números", () => {
    const m = buildCareerMarket(input([...withSalary(9), job("x")]));
    expect(m.salary).toMatchObject({ informed: 9, total: 10, enough: false, median: null });
  });

  it("sueldos con N = 10: con números", () => {
    const m = buildCareerMarket(input(withSalary(10)));
    expect(m.salary).toMatchObject({ informed: 10, enough: true, median: 5500 });
  });

  it("un anual cargado como mensual se descarta", () => {
    const m = buildCareerMarket(
      input([job("a", { salaryMinUsd: 90000, salaryMaxUsd: 90000, salaryPeriod: "mensual" })]),
    );
    expect(m.salary.informed).toBe(0);
  });
});

describe("buildCareerMarket · volumen", () => {
  it("nuevas en 24 h: el borde entra", () => {
    const m = buildCareerMarket(
      input([
        job("a", { publishedAt: "2026-10-15T12:00:00.000Z" }),
        job("b", { publishedAt: "2026-10-15T11:59:59.999Z" }),
        job("c", { publishedAt: "2026-10-16T11:00:00.000Z" }),
      ]),
    );
    expect(m.volume.new24h).toBe(2);
  });

  it("modalidad: lo desconocido va a desconocida", () => {
    const m = buildCareerMarket(
      input([
        job("a", { modality: "remoto" }),
        job("b", { modality: "hibrido" }),
        job("c", { modality: "presencial" }),
        job("d", { modality: null }),
        job("e", { modality: "otra" }),
      ]),
    );
    expect(m.volume.modality).toEqual({ remoto: 1, hibrido: 1, presencial: 1, desconocida: 2 });
  });

  it("alcance desde Argentina", () => {
    const m = buildCareerMarket(
      input([
        job("a", { countriesAllowed: ["*"] }),
        job("b", { countriesAllowed: ["AR", "CL"] }),
        job("c", { countriesAllowed: ["US"] }),
        job("d", { countriesAllowed: ["LATAM"] }),
        job("e", { countriesAllowed: null, locationRaw: null }),
      ]),
    );
    expect(m.volume.fromArgentina).toEqual({ acepta: 3, no_acepta: 1, no_dice: 1 });
  });

  it("fuentes: ATS juntos, sin atribución en 'Otras fuentes', orden por cantidad y nombre", () => {
    const kinds = [
      "greenhouse",
      "lever",
      "ashby",
      "remoteok",
      "jobicy",
      "email_generic",
      "manual",
      "inventada",
    ];
    const m = buildCareerMarket(input(kinds.map((k, i) => job(`k${i}`, { sourceKind: k }))));
    expect(m.volume.sources).toEqual([
      { name: "Otras fuentes", jobs: 3 },
      { name: "Sitios de empleos de las empresas", jobs: 3 },
      { name: "Jobicy", jobs: 1 },
      { name: "Remote OK", jobs: 1 },
    ]);
  });
});
