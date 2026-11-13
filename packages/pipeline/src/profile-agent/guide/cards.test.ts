import { describe, expect, it } from "vitest";
import {
  GUIDE_MAX_ALERT_KEYWORDS,
  buildGuideCards,
  guideDemandFromMarket,
  selectReinforceSkills,
  type GuideDemand,
} from "./cards";
import { GUIDE_PROMISE_RE } from "./copy";
import type { ProfileGuideAnswers } from "../schemas";

const demand: GuideDemand = {
  poolSize: 40,
  skills: [
    { slug: "excel", name: "Excel", jobs: 30, must: 20 },
    { slug: "sql", name: "SQL", jobs: 20, must: 5 },
    { slug: "power_bi", name: "Power BI", jobs: 20, must: 9 },
    { slug: "rara", name: "Rara", jobs: 2, must: 2 },
    { slug: "poca", name: "Poca", jobs: 5, must: 1 },
    { slug: "ingles", name: "Inglés", jobs: 12, must: 6 },
  ],
};

describe("selectReinforceSkills: salen de datos, no de la opinión de un modelo", () => {
  it("las más pedidas que la persona no maneja, con su evidencia", () => {
    const r = selectReinforceSkills(demand, { excel: 3, sql: 1 });
    // sql y power_bi empatan en ofertas: gana la que más pide como excluyente
    expect(r.map((k) => k.slug)).toEqual(["power_bi", "sql", "ingles"]);
    expect(r[1]).toEqual({ slug: "sql", name: "SQL", offersAsking: 20, poolSize: 40 });
  });

  it("desempata por excluyentes y después por slug", () => {
    const r = selectReinforceSkills(demand, {});
    expect(r.map((k) => k.slug)).toEqual(["excel", "power_bi", "sql"]);
  });

  it("descarta las poco pedidas (por porcentaje y por cantidad)", () => {
    const slugs = selectReinforceSkills(demand, {}).map((k) => k.slug);
    expect(slugs).not.toContain("rara");
    expect(slugs).not.toContain("poca");
  });

  it("con un pool chico o sin datos no propone nada (falla cerrado)", () => {
    expect(selectReinforceSkills({ ...demand, poolSize: 9 }, {})).toEqual([]);
    expect(selectReinforceSkills({ ...demand, poolSize: Number.NaN }, {})).toEqual([]);
    expect(selectReinforceSkills({ poolSize: 0, skills: [] }, {})).toEqual([]);
  });

  it("una skill que dice pedirse en más ofertas que el pool es un dato inválido: no entra", () => {
    const bad: GuideDemand = {
      poolSize: 10,
      skills: [{ slug: "x", name: "XX", jobs: 50, must: 1 }],
    };
    expect(selectReinforceSkills(bad, {})).toEqual([]);
  });

  it("guideDemandFromMarket toma el total y solo los campos que usa", () => {
    const d = guideDemandFromMarket({
      total: 25,
      skills: [{ slug: "sql", name: "SQL", jobs: 9, must: 2, nice: 7, share: 0.36 } as never],
    });
    expect(d).toEqual({ poolSize: 25, skills: [{ slug: "sql", name: "SQL", jobs: 9, must: 2 }] });
  });
});

describe("buildGuideCards", () => {
  const answers: ProfileGuideAnswers = {
    roles: ["abogacia"],
    modalities: ["remoto"] as ("remoto" | "hibrido" | "presencial")[],
    country: "AR",
    maxYearsHard: 4,
    salaryFloorUsdMonthly: 900,
    avoid: ["guardia"],
  };

  it("arma puestos, criterios, tres portales y skills a reforzar, en ese orden", () => {
    const cards = buildGuideCards({ answers, language: "es", demand, levels: {} });
    expect(cards.map((c) => c.kind)).toEqual([
      "roles",
      "criteria",
      "alert_keywords",
      "alert_keywords",
      "alert_keywords",
      "reinforce",
      "reinforce",
      "reinforce",
    ]);
    expect(cards[1]).toEqual({
      kind: "criteria",
      modalities: ["remoto"],
      country: "AR",
      maxYearsHard: 4,
      salaryFloorUsdMonthly: 900,
      titleBlocklistAdd: ["guardia"],
    });
    const portals = cards.flatMap((c) => (c.kind === "alert_keywords" ? [c.portal] : []));
    expect(portals).toEqual(["linkedin", "indeed", "getonboard"]);
  });

  it("las palabras de alerta son las curadas de la carrera, acotadas", () => {
    const c = buildGuideCards({ answers, language: "both", demand: null, levels: {} }).find(
      (x) => x.kind === "alert_keywords",
    );
    if (c?.kind !== "alert_keywords") throw new Error("falta");
    expect(c.keywords.length).toBeGreaterThan(0);
    expect(c.keywords.length).toBeLessThanOrEqual(GUIDE_MAX_ALERT_KEYWORDS);
    expect(c.language).toBe("both");
  });

  it("sin puestos no hay palabras de alerta; sin elecciones no hay tarjeta de criterios", () => {
    const cards = buildGuideCards({
      answers: {
        roles: [],
        modalities: [],
        maxYearsHard: null,
        salaryFloorUsdMonthly: null,
        avoid: [],
      },
      language: "es",
      demand: null,
      levels: {},
    });
    expect(cards).toEqual([]);
  });

  it("sin datos del pool no hay skills a reforzar, y la evidencia es obligatoria", () => {
    const sin = buildGuideCards({ answers, language: "es", demand: null, levels: {} });
    expect(sin.some((c) => c.kind === "reinforce")).toBe(false);
    for (const c of buildGuideCards({ answers, language: "es", demand, levels: {} })) {
      if (c.kind === "reinforce") expect(c.evidence.offersAsking).toBeGreaterThan(0);
    }
  });

  it("solo lo que la persona eligió: un criterio no contestado queda null", () => {
    const cards = buildGuideCards({
      answers: { country: "UY" },
      language: "es",
      demand: null,
      levels: {},
    });
    expect(cards).toEqual([
      {
        kind: "criteria",
        modalities: null,
        country: "UY",
        maxYearsHard: null,
        salaryFloorUsdMonthly: null,
        titleBlocklistAdd: [],
      },
    ]);
  });

  it("las tarjetas no llevan texto libre de un modelo ni promesas", () => {
    const cards = buildGuideCards({ answers, language: "es", demand, levels: {} });
    expect(JSON.stringify(cards)).not.toMatch(GUIDE_PROMISE_RE);
  });
});
