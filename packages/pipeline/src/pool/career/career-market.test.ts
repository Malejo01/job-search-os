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
    expect(m.salary.latam).toMatchObject({ informed: 0, total: 0, enough: false });
    expect(m.salary.international).toMatchObject({ informed: 0, total: 0, enough: false });
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

  it("cuenta los avisos en español: por lang guardado o por el texto", () => {
    const text =
      "Buscamos un desarrollador para el equipo de producto. Vas a trabajar con los datos de la empresa y con una API en el stack de Node, con deploy en remote. Es un puesto en la oficina.";
    const m = buildCareerMarket(
      input([
        job("1", { lang: "es" }),
        job("2", { lang: null, jdText: text }),
        job("3", { lang: "en" }),
        job("4", { lang: "pt" }),
        job("5", { lang: null, jdText: "React" }),
      ]),
    );
    expect(m.english.writtenInSpanish).toBe(2);
  });

  const withSalary = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      job(`s${i}`, {
        salaryMinUsd: 1000 * (i + 1),
        salaryMaxUsd: 1000 * (i + 1),
        salaryPeriod: "mensual",
      }),
    );

  const inAr = { countriesAllowed: ["AR"] };

  it("sueldos con N = 9: sin números", () => {
    const m = buildCareerMarket(input([...withSalary(9), job("x")]));
    expect(m.salary.international).toMatchObject({
      informed: 9,
      total: 10,
      enough: false,
      p25: null,
      median: null,
      p75: null,
    });
  });

  it("sueldos con N = 10: con números", () => {
    const m = buildCareerMarket(input(withSalary(10)));
    expect(m.salary.international).toMatchObject({ informed: 10, enough: true, median: 5500 });
  });

  it("un anual cargado como mensual se descarta", () => {
    const m = buildCareerMarket(
      input([job("a", { salaryMinUsd: 90000, salaryMaxUsd: 90000, salaryPeriod: "mensual" })]),
    );
    expect(m.salary.international.informed).toBe(0);
    expect(m.salary.latam.informed).toBe(0);
  });

  it("un aviso mensual que acepta Argentina cae en latam", () => {
    const m = buildCareerMarket(
      input([
        job("a", { ...inAr, salaryMinUsd: 2000, salaryMaxUsd: 3000, salaryPeriod: "mensual" }),
      ]),
    );
    expect(m.salary.latam).toMatchObject({ informed: 1, total: 1 });
    expect(m.salary.international).toMatchObject({ informed: 0, total: 0 });
  });

  it("un aviso 'any' anual cae en international", () => {
    const m = buildCareerMarket(
      input([
        job("a", {
          countriesAllowed: ["*"],
          salaryMinUsd: 120000,
          salaryMaxUsd: 180000,
          salaryPeriod: "anual",
        }),
      ]),
    );
    expect(m.salary.latam.informed).toBe(0);
    expect(m.salary.international).toMatchObject({ informed: 1, total: 1 });
  });

  it("los avisos que no aceptan Argentina o no dicen van a international", () => {
    const m = buildCareerMarket(
      input([job("a", { countriesAllowed: ["US"] }), job("b", { countriesAllowed: null })]),
    );
    expect(m.salary.latam.total).toBe(0);
    expect(m.salary.international.total).toBe(2);
  });

  it("una región de LatAm cuenta como explícita; 'worldwide' no", () => {
    const m = buildCareerMarket(
      input([
        job("a", { countriesAllowed: null, locationRaw: "Latin America" }),
        job("b", { countriesAllowed: null, locationRaw: "Anywhere in the World" }),
      ]),
    );
    expect(m.salary.latam.total).toBe(1);
    expect(m.salary.international.total).toBe(1);
  });

  it("latam e international se calculan por separado, sin mezcla", () => {
    const latam = Array.from({ length: 10 }, (_, i) =>
      job(`l${i}`, {
        ...inAr,
        salaryMinUsd: 2000,
        salaryMaxUsd: 2000,
        salaryPeriod: "mensual",
      }),
    );
    const intl = Array.from({ length: 10 }, (_, i) =>
      job(`i${i}`, {
        countriesAllowed: ["*"],
        salaryMinUsd: 120000,
        salaryMaxUsd: 120000,
        salaryPeriod: "anual",
      }),
    );
    const m = buildCareerMarket(input([...latam, ...intl]));
    expect(m.salary.latam).toMatchObject({ enough: true, median: 2000 });
    expect(m.salary.international).toMatchObject({ enough: true, median: 10000 });
  });

  it("las celdas por seniority llevan su propio N y umbral", () => {
    const seniors = Array.from({ length: 10 }, (_, i) =>
      job(`s${i}`, {
        ...inAr,
        seniority: "Senior",
        salaryMinUsd: 4000,
        salaryMaxUsd: 4000,
        salaryPeriod: "mensual",
      }),
    );
    const semis = Array.from({ length: 3 }, (_, i) =>
      job(`m${i}`, {
        ...inAr,
        seniority: "Semi Senior",
        salaryMinUsd: 2000,
        salaryMaxUsd: 2000,
        salaryPeriod: "mensual",
      }),
    );
    const m = buildCareerMarket(
      input([...seniors, ...semis, job("j", { ...inAr, seniority: "Junior" })]),
    );
    const { latam } = m.salary;
    expect(latam).toMatchObject({ informed: 13, total: 14, enough: true });
    expect(latam.bySeniority.senior).toMatchObject({
      informed: 10,
      total: 10,
      enough: true,
      median: 4000,
    });
    expect(latam.bySeniority.semi).toMatchObject({
      informed: 3,
      total: 3,
      enough: false,
      median: null,
    });
    expect(latam.bySeniority.junior).toMatchObject({ informed: 0, total: 1, enough: false });
    expect(latam.bySeniority.lead).toMatchObject({ informed: 0, total: 0 });
  });

  it("la regla A descarta un anual de 12000", () => {
    const m = buildCareerMarket(
      input([job("a", { salaryMinUsd: 12000, salaryMaxUsd: 12000, salaryPeriod: "anual" })]),
    );
    expect(m.salary.international).toMatchObject({ informed: 0, total: 1 });
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

  it("últimos 7 días: cuenta el borde y separa los escritos en español", () => {
    const es = "Buscamos una persona para sumarse a nuestro equipo de desarrollo en la empresa";
    const m = buildCareerMarket(
      input([
        job("a", { publishedAt: "2026-10-09T12:00:00.000Z", lang: "es", jdText: es }),
        job("b", { publishedAt: "2026-10-09T11:59:59.999Z", lang: "es", jdText: es }),
        job("c", { publishedAt: "2026-10-15T12:00:00.000Z", lang: "en" }),
      ]),
    );
    expect(m.volume.last7d).toEqual({ total: 2, writtenInSpanish: 1 });
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
