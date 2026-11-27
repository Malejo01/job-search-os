import { describe, expect, it } from "vitest";
import {
  COVERAGE_ENTRY_THRESHOLD,
  COVERAGE_TOMABLE_THRESHOLD,
  COVERAGE_TREND_DAYS,
  COVERAGE_VIGENTE_DAYS,
  careerCoverage,
  coverageSemaphore,
  isParaEmpezar,
  isTomable,
  isVigente,
  type CoverageJob,
} from "./career-coverage";

const DAY = 86_400_000;
const NOW = new Date("2026-11-26T12:00:00Z");
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);

describe("isVigente", () => {
  it("la vigencia es de 7 días", () => {
    expect(COVERAGE_VIGENTE_DAYS).toBe(7);
  });
  it("vista hoy o hace 7 días exactos: vigente", () => {
    expect(isVigente(ago(0), NOW)).toBe(true);
    expect(isVigente(ago(7), NOW)).toBe(true);
  });
  it("vista hace más de 7 días: no", () => {
    expect(isVigente(new Date(ago(7).getTime() - 1), NOW)).toBe(false);
    expect(isVigente(ago(30), NOW)).toBe(false);
  });
  it("sin fecha o con fecha inválida: no (falla cerrado)", () => {
    expect(isVigente(null, NOW)).toBe(false);
    expect(isVigente(undefined, NOW)).toBe(false);
    expect(isVigente(new Date("x"), NOW)).toBe(false);
    expect(isVigente(ago(1), new Date("x"))).toBe(false);
  });
});

describe("isTomable", () => {
  it("Argentina explícita en los países", () => {
    expect(isTomable({ countriesAllowed: ["AR"] })).toBe(true);
    expect(isTomable({ countriesAllowed: ["BR", "AR"], locationRaw: "Remoto" })).toBe(true);
  });
  it("su región (LATAM) o todo el mundo explícitos", () => {
    expect(isTomable({ countriesAllowed: ["LATAM"] })).toBe(true);
    expect(isTomable({ countriesAllowed: ["LATINOAMÉRICA"] })).toBe(true);
    expect(isTomable({ countriesAllowed: ["Worldwide"] })).toBe(true);
    expect(isTomable({ countriesAllowed: ["*"] })).toBe(true);
  });
  it("el lugar de trabajo está en Argentina, aunque no diga países", () => {
    expect(isTomable({ countriesAllowed: null, locationRaw: "Buenos Aires, Argentina" })).toBe(
      true,
    );
    expect(isTomable({ countriesAllowed: [], locationCountry: "AR" })).toBe(true);
    expect(isTomable({ countriesAllowed: null, locationCountry: "ar" })).toBe(true);
  });
  it("sin países y sin lugar en Argentina no cuenta", () => {
    expect(isTomable({ countriesAllowed: null })).toBe(false);
    expect(isTomable({ countriesAllowed: [] })).toBe(false);
    expect(isTomable({ countriesAllowed: null, locationRaw: "Remoto" })).toBe(false);
    expect(isTomable({ countriesAllowed: null, locationRaw: "Madrid, España" })).toBe(false);
    expect(isTomable({ countriesAllowed: null, locationCountry: "ES" })).toBe(false);
  });
  it("países que no incluyen Argentina ni su región no cuentan", () => {
    expect(isTomable({ countriesAllowed: ["US"] })).toBe(false);
    expect(isTomable({ countriesAllowed: ["DE", "FR"] })).toBe(false);
    expect(isTomable({ countriesAllowed: ["EU"] })).toBe(false);
  });
  it("lo que no se entiende no cuenta", () => {
    expect(isTomable({ countriesAllowed: ["???"] })).toBe(false);
    expect(isTomable({ countriesAllowed: ["US time zones"] })).toBe(false);
  });
  it("el texto de la ubicación solo cuenta si nombra Argentina, no una región", () => {
    expect(isTomable({ countriesAllowed: null, locationRaw: "Remoto, LATAM" })).toBe(false);
  });
});

describe("isParaEmpezar", () => {
  it("usa la misma señal que el chip «Para empezar»", () => {
    expect(isParaEmpezar({ seniority: "Junior", title: "Analista" })).toBe(true);
    expect(isParaEmpezar({ seniority: null, title: "Desarrollador Jr" })).toBe(true);
    expect(isParaEmpezar({ seniority: null, title: "Pasante de contabilidad (trainee)" })).toBe(
      true,
    );
  });
  it("sin señal o con nivel mayor no entra", () => {
    expect(isParaEmpezar({ seniority: null, title: "Analista contable" })).toBe(false);
    expect(isParaEmpezar({ seniority: "Senior", title: "Analista" })).toBe(false);
  });
});

describe("coverageSemaphore", () => {
  it("los umbrales son 30 tomables y 10 para quien empieza", () => {
    expect(COVERAGE_TOMABLE_THRESHOLD).toBe(30);
    expect(COVERAGE_ENTRY_THRESHOLD).toBe(10);
  });
  it("verde con los dos umbrales cumplidos (en el borde)", () => {
    expect(coverageSemaphore({ tomables: 30, paraEmpezar: 10 })).toBe("verde");
    expect(coverageSemaphore({ tomables: 80, paraEmpezar: 25 })).toBe("verde");
  });
  it("rojo con uno solo no alcanza si el otro está lejos; amarillo si está cerca", () => {
    expect(coverageSemaphore({ tomables: 29, paraEmpezar: 10 })).toBe("amarillo");
    expect(coverageSemaphore({ tomables: 30, paraEmpezar: 9 })).toBe("amarillo");
    expect(coverageSemaphore({ tomables: 15, paraEmpezar: 5 })).toBe("amarillo");
    expect(coverageSemaphore({ tomables: 14, paraEmpezar: 5 })).toBe("rojo");
    expect(coverageSemaphore({ tomables: 40, paraEmpezar: 4 })).toBe("rojo");
    expect(coverageSemaphore({ tomables: 0, paraEmpezar: 0 })).toBe("rojo");
  });
});

const job = (over: Partial<CoverageJob> = {}): CoverageJob => ({
  roleHints: ["abogacia"],
  sourceKind: "getonboard",
  countriesAllowed: ["AR"],
  locationRaw: null,
  locationCountry: null,
  seniority: null,
  title: "Abogado",
  language: "es",
  firstSeenAt: ago(20),
  lastSeenAt: ago(1),
  ...over,
});

const many = (n: number, over: Partial<CoverageJob> | ((i: number) => Partial<CoverageJob>)) =>
  Array.from({ length: n }, (_, i) => job(typeof over === "function" ? over(i) : over));

describe("careerCoverage", () => {
  it("una fila por carrera pedida, en ese orden, también las vacías (rojo)", () => {
    const rows = careerCoverage(["comunicacion", "abogacia"], [job()], NOW);
    expect(rows.map((r) => r.role)).toEqual(["comunicacion", "abogacia"]);
    expect(rows[0]).toMatchObject({
      vigentes: 0,
      tomables: 0,
      paraEmpezar: 0,
      enEspanol: 0,
      sources: [],
      semaforo: "rojo",
    });
  });

  it("cuenta vigentes, tomables, para quien empieza y en español", () => {
    const jobs = [
      job(), // vigente, tomable, español
      job({ seniority: "junior", language: "en" }), // tomable, para empezar, inglés
      job({ countriesAllowed: null }), // vigente, no tomable
      job({ lastSeenAt: ago(10), seniority: "junior" }), // no vigente: no cuenta en nada
    ];
    const [r] = careerCoverage(["abogacia"], jobs, NOW);
    expect(r).toMatchObject({ vigentes: 3, tomables: 2, paraEmpezar: 1, enEspanol: 2 });
  });

  it("«para quien empieza» cuenta solo entre las tomables", () => {
    const jobs = [job({ seniority: "junior", countriesAllowed: ["US"] })];
    const [r] = careerCoverage(["abogacia"], jobs, NOW);
    expect(r).toMatchObject({ vigentes: 1, tomables: 0, paraEmpezar: 0 });
  });

  it("una oferta con varias carreras cuenta una vez en cada una; las de otras carreras se ignoran", () => {
    const jobs = [job({ roleHints: ["abogacia", "comunicacion"] }), job({ roleHints: ["otra"] })];
    const rows = careerCoverage(["abogacia", "comunicacion"], jobs, NOW);
    expect(rows.map((r) => r.vigentes)).toEqual([1, 1]);
  });

  it("de qué fuentes vienen: de más a menos tomables, empate por nombre", () => {
    const jobs = [
      ...many(2, { sourceKind: "b_fuente" }),
      ...many(2, { sourceKind: "a_fuente" }),
      job({ sourceKind: "c_fuente" }),
      job({ sourceKind: "c_fuente", countriesAllowed: null }),
      job({ sourceKind: "d_fuente", countriesAllowed: null }),
    ];
    const [r] = careerCoverage(["abogacia"], jobs, NOW);
    expect(r?.sources).toEqual([
      { source: "a_fuente", vigentes: 2, tomables: 2 },
      { source: "b_fuente", vigentes: 2, tomables: 2 },
      { source: "c_fuente", vigentes: 2, tomables: 1 },
      { source: "d_fuente", vigentes: 1, tomables: 0 },
    ]);
  });

  it("semáforo verde y rojo según el umbral", () => {
    const verde = [
      ...many(20, { language: "es" }),
      ...many(10, { seniority: "junior", language: "es" }),
    ];
    const rojo = many(3, { roleHints: ["comunicacion"] });
    const rows = careerCoverage(["abogacia", "comunicacion"], [...verde, ...rojo], NOW);
    expect(rows[0]).toMatchObject({ tomables: 30, paraEmpezar: 10, semaforo: "verde" });
    expect(rows[1]).toMatchObject({ tomables: 3, paraEmpezar: 0, semaforo: "rojo" });
  });

  it("tendencia: ofertas tomables nuevas por día en los últimos 14 días, si los datos alcanzan", () => {
    expect(COVERAGE_TREND_DAYS).toBe(14);
    const jobs = [
      job({ firstSeenAt: ago(30) }), // prueba que el pool tiene más de 14 días de historia
      job({ firstSeenAt: ago(0.5) }), // último día
      job({ firstSeenAt: ago(0.2) }), // último día
      job({ firstSeenAt: ago(13.5) }), // primer día
      job({ firstSeenAt: ago(3), countriesAllowed: null }), // no tomable: no suma
    ];
    const [r] = careerCoverage(["abogacia"], jobs, NOW);
    const t = r?.trend;
    expect(t).not.toBeNull();
    expect(t?.porDia).toHaveLength(14);
    expect(t?.porDia[13]).toBe(2);
    expect(t?.porDia[0]).toBe(1);
    expect(t?.porDia.reduce((a, b) => a + b, 0)).toBe(3);
    expect(t?.ultimos7).toBe(2);
    expect(t?.previos7).toBe(1);
  });

  it("tendencia: null si el pool de esa carrera no tiene 14 días de historia", () => {
    const [r] = careerCoverage(["abogacia"], [job({ firstSeenAt: ago(5) })], NOW);
    expect(r?.trend).toBeNull();
  });

  it("es determinista: no muta la entrada ni depende del orden", () => {
    const jobs = [job({ sourceKind: "b" }), job({ sourceKind: "a", seniority: "junior" })];
    const copy = structuredClone(jobs);
    const a = careerCoverage(["abogacia"], jobs, NOW);
    const b = careerCoverage(["abogacia"], [...jobs].reverse(), NOW);
    expect(a).toEqual(b);
    expect(jobs).toEqual(copy);
  });
});
