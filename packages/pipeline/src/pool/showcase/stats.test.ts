import { describe, expect, it } from "vitest";
import {
  buildPoolShowcase,
  pickShowcaseJobs,
  SHOWCASE_SOURCES,
  type ShowcaseJobRow,
  type ShowcasePoolRow,
} from "./stats";

const NOW = "2026-10-20T12:00:00Z";
const hoursAgo = (h: number) => new Date(Date.parse(NOW) - h * 3600_000).toISOString();

function row(over: Partial<ShowcasePoolRow> = {}): ShowcasePoolRow {
  return {
    roleHints: ["frontend"],
    modality: "remoto",
    countriesAllowed: null,
    locationRaw: null,
    companyRaw: "Empresa A",
    sourceKind: "remoteok",
    firstSeenAt: hoursAgo(72),
    ...over,
  };
}

describe("buildPoolShowcase", () => {
  it("cuenta activas, fuentes distintas y nuevas en 24 h", () => {
    const s = buildPoolShowcase({
      jobs: [
        row({ firstSeenAt: hoursAgo(2) }),
        row({ sourceKind: "jobicy", firstSeenAt: hoursAgo(23) }),
        row({ sourceKind: "jobicy", firstSeenAt: hoursAgo(25) }),
      ],
      poolUpdatedAt: hoursAgo(3.5),
      now: NOW,
    });
    expect(s).toMatchObject({ active: 3, sources: 2, new24h: 2, updatedHoursAgo: 3 });
  });

  it("sin pool: ceros y sin hora de actualización", () => {
    const s = buildPoolShowcase({ jobs: [], poolUpdatedAt: null, now: NOW });
    expect(s).toMatchObject({ active: 0, sources: 0, new24h: 0, updatedHoursAgo: null });
    expect(s.remoteByRole).toEqual([]);
    expect(s.topCompanies).toEqual([]);
  });

  it("ranking de carreras remotas: solo remoto, solo claves válidas, de mayor a menor", () => {
    const s = buildPoolShowcase({
      jobs: [
        row({ roleHints: ["backend", "fullstack"] }),
        row({ roleHints: ["backend"] }),
        row({ roleHints: ["qa"], modality: "hibrido" }),
        row({ roleHints: ["inventada"] }),
        row({ roleHints: ["frontend", "frontend"] }),
      ],
      poolUpdatedAt: null,
      now: NOW,
    });
    expect(s.remoteByRole).toEqual([
      { role: "backend", remote: 2 },
      { role: "frontend", remote: 1 },
      { role: "fullstack", remote: 1 },
    ]);
  });

  it("separa acepta, no acepta y no dice para Argentina", () => {
    const s = buildPoolShowcase({
      jobs: [
        row({ countriesAllowed: ["AR", "BR"] }),
        row({ locationRaw: "LATAM" }),
        row({ locationRaw: "Worldwide" }),
        row({ countriesAllowed: ["US"] }),
        row({ locationRaw: "Europe" }),
        row({ locationRaw: null }),
        row({ locationRaw: "Remote" }),
      ],
      poolUpdatedAt: null,
      now: NOW,
    });
    expect(s.argentina).toEqual({ accepts: 3, excludes: 2, unknown: 2 });
  });

  it("top de empresas: agrupa sin mayúsculas ni acentos, muestra la grafía más usada y corta en 10", () => {
    const many = (company: string, n: number) =>
      Array.from({ length: n }, () => row({ companyRaw: company }));
    const jobs = [
      ...many("Empresa B", 4),
      row({ companyRaw: "EMPRESA B" }),
      ...many("empresa ñ", 5),
      row({ companyRaw: "  " }),
      ...Array.from({ length: 11 }, (_, i) => many(`Empresa Z${i}`, 5)).flat(),
    ];
    const s = buildPoolShowcase({ jobs, poolUpdatedAt: null, now: NOW });
    expect(s.topCompanies).toHaveLength(10);
    expect(s.topCompanies[0]).toEqual({ company: "Empresa B", jobs: 5 });
    expect(s.computedAt).toBe(NOW);
  });

  it("las empresas con menos de 5 avisos no entran al top", () => {
    const jobs = [
      ...Array.from({ length: 4 }, () => row({ companyRaw: "Empresa C" })),
      ...Array.from({ length: 5 }, () => row({ companyRaw: "Empresa D" })),
    ];
    const s = buildPoolShowcase({ jobs, poolUpdatedAt: null, now: NOW });
    expect(s.topCompanies).toEqual([{ company: "Empresa D", jobs: 5 }]);
  });
});

describe("pickShowcaseJobs", () => {
  const job = (id: string, over: Partial<ShowcaseJobRow> = {}): ShowcaseJobRow => ({
    id,
    title: `Puesto ${id}`,
    companyRaw: "Empresa A",
    locationRaw: " Remoto ",
    modality: "remoto",
    sourceKind: "remoteok",
    sourceUrl: "https://example.com/x",
    publishedAt: hoursAgo(10),
    skills: [],
    ...over,
  });

  it("ordena por fecha, corta al tope y no trae descripción", () => {
    const out = pickShowcaseJobs(
      [
        job("a", { publishedAt: hoursAgo(30) }),
        job("b", { publishedAt: hoursAgo(1) }),
        job("c", { publishedAt: hoursAgo(5) }),
      ],
      2,
    );
    expect(out.map((c) => c.id)).toEqual(["b", "c"]);
    expect(Object.keys(out[0]!)).not.toContain("jdText");
    expect(out[0]!.location).toBe("Remoto");
  });

  it("skills: primero las excluyentes, sin repetidas y hasta 5", () => {
    const [card] = pickShowcaseJobs(
      [
        job("a", {
          skills: [
            { name: "S1", isMust: false },
            { name: "S2", isMust: true },
            { name: "S3", isMust: false },
            { name: "S2", isMust: false },
            { name: "S4", isMust: true },
            { name: "S5", isMust: false },
            { name: "S6", isMust: false },
          ],
        }),
      ],
      5,
    );
    expect(card!.skills).toEqual(["S2", "S4", "S1", "S3", "S5"]);
  });

  it("limit 0 o negativo no trae nada", () => {
    expect(pickShowcaseJobs([job("a")], 0)).toEqual([]);
    expect(pickShowcaseJobs([job("a")], -3)).toEqual([]);
  });
});

describe("SHOWCASE_SOURCES", () => {
  it("es una lista de permitidos: wwr y himalayas no entran", () => {
    expect(SHOWCASE_SOURCES).toEqual([
      "getonboard_api",
      "remoteok",
      "jobicy",
      "greenhouse",
      "lever",
      "ashby",
    ]);
    expect(SHOWCASE_SOURCES).not.toContain("wwr");
    expect(SHOWCASE_SOURCES).not.toContain("himalayas");
  });
});
