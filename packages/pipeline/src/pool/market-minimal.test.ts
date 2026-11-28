import { describe, expect, it } from "vitest";
import {
  MARKET_MIN_JOBS,
  MARKET_TOP_SKILLS,
  buildMarketMinimal,
  type MarketMinimalJob,
  type MarketMinimalSkill,
} from "./market-minimal";

const DAY = 86_400_000;
const NOW = new Date("2026-11-27T12:00:00Z");
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);

let seq = 0;
function job(over: Partial<MarketMinimalJob> = {}): MarketMinimalJob {
  seq += 1;
  return {
    id: `j${seq}`,
    title: "Analista de datos",
    seniority: null,
    modality: "remoto",
    countriesAllowed: ["AR"],
    locationRaw: null,
    lastSeenAt: ago(1),
    salaryOriginal: null,
    ...over,
  };
}
const many = (n: number, over: Partial<MarketMinimalJob> = {}) =>
  Array.from({ length: n }, () => job(over));

describe("buildMarketMinimal: cuántas ofertas", () => {
  it("cuenta vigentes, tomables y para quien empieza con las reglas de la cobertura", () => {
    const jobs = [
      job(), // tomable
      job({ title: "Analista junior", seniority: "junior" }), // tomable y para empezar
      job({ countriesAllowed: ["BR"], seniority: "junior", title: "Dev junior" }), // vigente, no tomable
      job({ countriesAllowed: null }), // no dice: no cuenta como tomable
      job({ lastSeenAt: ago(8) }), // ya no vigente
    ];
    const r = buildMarketMinimal({ jobs, skills: [], userSkills: [], now: NOW });
    expect(r.vigentes).toBe(4);
    expect(r.tomables).toBe(2);
    expect(r.paraEmpezar).toBe(1);
  });

  it("sin ofertas: todo en cero y sin gráfico", () => {
    const r = buildMarketMinimal({ jobs: [], skills: [], userSkills: [], now: NOW });
    expect(r.vigentes).toBe(0);
    expect(r.enoughForChart).toBe(false);
    expect(r.skills).toEqual([]);
    expect(r.salary.groups).toEqual([]);
  });

  it("dice la fecha del cálculo", () => {
    const r = buildMarketMinimal({ jobs: [], skills: [], userSkills: [], now: NOW });
    expect(r.asOf).toBe("2026-11-27T12:00:00.000Z");
  });

  it("con menos de 10 avisos no hay gráfico; con 10, sí", () => {
    expect(MARKET_MIN_JOBS).toBe(10);
    const nine = buildMarketMinimal({ jobs: many(9), skills: [], userSkills: [], now: NOW });
    expect(nine.enoughForChart).toBe(false);
    const ten = buildMarketMinimal({ jobs: many(10), skills: [], userSkills: [], now: NOW });
    expect(ten.enoughForChart).toBe(true);
  });
});

describe("buildMarketMinimal: habilidades", () => {
  const jobs = many(10);
  const ids = jobs.map((j) => j.id);
  const sk = (i: number, slug: string, isMust = true): MarketMinimalSkill => ({
    jobId: ids[i]!,
    slug,
    name: slug.toUpperCase(),
    isMust,
  });

  it("ordena por avisos que la piden y marca las que la persona ya tiene", () => {
    const skills = [
      sk(0, "sql"),
      sk(1, "sql"),
      sk(2, "sql", false),
      sk(0, "excel"),
      sk(1, "excel"),
      sk(0, "python"),
    ];
    const r = buildMarketMinimal({ jobs, skills, userSkills: ["excel"], now: NOW });
    expect(r.skills.map((s) => [s.slug, s.jobs, s.have])).toEqual([
      ["sql", 3, false],
      ["excel", 2, true],
      ["python", 1, false],
    ]);
    expect(r.skills[0]?.share).toBeCloseTo(0.3);
  });

  it("no cuenta habilidades de avisos que no son vigentes", () => {
    const old = job({ lastSeenAt: ago(20) });
    const r = buildMarketMinimal({
      jobs: [...jobs, old],
      skills: [{ jobId: old.id, slug: "sql", name: "SQL", isMust: true }],
      userSkills: [],
      now: NOW,
    });
    expect(r.skills).toEqual([]);
  });

  it("un aviso que repite la habilidad cuenta una vez; tope de filas", () => {
    expect(MARKET_TOP_SKILLS).toBe(8);
    const skills = [
      sk(0, "sql"),
      sk(0, "sql"),
      sk(1, "sql"),
      ...Array.from({ length: 12 }, (_, i) => sk(i % 10, `h${i}`)),
    ];
    const r = buildMarketMinimal({ jobs, skills, userSkills: [], now: NOW });
    expect(r.skills.find((s) => s.slug === "sql")?.jobs).toBe(2);
    expect(r.skills).toHaveLength(8);
  });
});

describe("buildMarketMinimal: modalidad y desde dónde", () => {
  it("cuenta modalidades y países", () => {
    const jobs = [
      job({ modality: "remoto" }),
      job({ modality: "hibrido", countriesAllowed: ["BR"] }),
      job({ modality: "presencial", countriesAllowed: null, locationRaw: null }),
      job({ modality: "otra", countriesAllowed: ["US"] }),
    ];
    const r = buildMarketMinimal({ jobs, skills: [], userSkills: [], now: NOW });
    expect(r.modality).toEqual({ remoto: 1, hibrido: 1, presencial: 1, desconocida: 1 });
    expect(r.origin).toEqual({ tomable: 1, noDice: 1, otros: 2 });
  });
});

describe("buildMarketMinimal: sueldos en la moneda original", () => {
  const withSalary = (n: number, currency: string, amount: number, period = "mensual") =>
    many(n).map((j) => ({
      ...j,
      salaryOriginal: { min: amount, max: amount + 100, currency, period } as never,
    }));

  it("agrupa por moneda y no mezcla; muestra solo con 10 casos o más", () => {
    const jobs = [...withSalary(10, "ARS", 1_000_000), ...withSalary(4, "USD", 2000)];
    const r = buildMarketMinimal({ jobs, skills: [], userSkills: [], now: NOW });
    expect(r.salary.withSalary).toBe(14);
    expect(r.salary.groups).toHaveLength(1);
    const g = r.salary.groups[0]!;
    expect(g.currency).toBe("ARS");
    expect(g.informed).toBe(10);
    expect(g.median).toBe(1_000_050);
    expect(g.period).toBe("mensual");
    expect(r.salary.hiddenCurrencies).toBe(1);
  });

  it("pasa lo anual y lo por hora a mes, y descarta lo que no dice período", () => {
    const jobs = [
      ...withSalary(5, "EUR", 24_000, "anual"),
      ...withSalary(5, "EUR", 2000, "mensual"),
      ...many(3).map((j) => ({
        ...j,
        salaryOriginal: { min: 5000, max: null, currency: "EUR", period: null } as never,
      })),
    ];
    const r = buildMarketMinimal({ jobs, skills: [], userSkills: [], now: NOW });
    expect(r.salary.groups[0]?.informed).toBe(10);
    expect(r.salary.withSalary).toBe(10);
  });

  it("sin moneda dicha no hay sueldo", () => {
    const r = buildMarketMinimal({ jobs: many(12), skills: [], userSkills: [], now: NOW });
    expect(r.salary.withSalary).toBe(0);
  });
});
