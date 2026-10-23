import { describe, expect, it } from "vitest";
import type { Checklist, ChecklistItem, ChecklistStatus } from "../evaluator/checklist";
import {
  buildFitSummary,
  fitCrossSentence,
  FIT_THRESHOLDS,
  type FitOffer,
  type FitSummary,
} from "./fit-summary";

const ZERO = { cumple: 0, no_cumple: 0, no_se_sabe: 0 };

function item(id: string, status: ChecklistStatus): ChecklistItem {
  return {
    id,
    kind: "estructurado",
    nivel: "must",
    pide: id,
    evidencia: null,
    tenes: null,
    status,
    fuente: { pide: "fuente", tenes: "perfil" },
    bloquea: false,
  };
}

function checklist(items: ChecklistItem[]): Checklist {
  return { items, must: ZERO, deseable: ZERO, parcial: false, descarte_rapido: null };
}

/** Oferta con esos estados por id y esas skills (slug, o «slug!» si es excluyente). */
function offer(states: Record<string, ChecklistStatus>, skills: string[] = []): FitOffer {
  const items = Object.entries(states).map(([id, s]) => item(id, s));
  const parsed = skills.map((s) => ({ slug: s.replace("!", ""), isMust: s.endsWith("!") }));
  return { checklist: checklist(items), skills: parsed };
}

function many(n: number, make: (i: number) => FitOffer): FitOffer[] {
  return Array.from({ length: n }, (_, i) => make(i));
}

type Market = Map<string, number> | null;

function fit(offers: FitOffer[], lv: Record<string, number> = {}, market: Market = null) {
  const levels = new Map(Object.entries(lv));
  return buildFitSummary({ offers, levels, marketShare: market });
}

const DONDE = { key: "donde", label: "Desde dónde se puede trabajar", count: 5 };

describe("buildFitSummary (C-6 E1)", () => {
  it("con menos de 5 ofertas con checklist no hay ranking de frenos", () => {
    const s = fit(many(4, () => offer({ ingles: "no_cumple" })));
    expect(s.basis).toEqual({ offers: 4, withChecklist: 4, smallSample: true });
    expect(s.blockers).toEqual([]);
    expect(s.headline).toMatch(/^Todavía tenés pocas ofertas/);
    expect(FIT_THRESHOLDS.minBase).toBe(5);
  });

  it("las ofertas sin checklist cuentan para las skills pero no para la base", () => {
    const old = { ...offer({}, ["sql!"]), checklist: null };
    const offers = many(6, () => old);
    const s = fit(offers, { sql: 1 });
    expect(s.basis.withChecklist).toBe(0);
    expect(s.gaps.map((g) => g.slug)).toEqual(["sql"]);
  });

  it("un freno necesita 2 ofertas y el 20 % de la base, con «N de M» en el titular", () => {
    const failing = many(3, () => offer({ ingles: "no_cumple", anos: "cumple" }));
    const passing = many(7, () => offer({ ingles: "cumple", anos: "cumple" }));
    const s = fit([...failing, ...passing]);
    expect(s.blockers).toEqual([{ key: "ingles", label: "Inglés", count: 3 }]);
    expect(s.headline).toBe("Lo que más te frena es «Inglés»: aparece en 3 de 10 ofertas.");
    // 1 de 10 no alcanza
    const nine = many(9, () => offer({ anos: "cumple" }));
    expect(fit([offer({ anos: "no_cumple" }), ...nine]).blockers).toEqual([]);
  });

  it("residencia y país se agrupan: una oferta cuenta una sola vez", () => {
    const s = fit(many(5, () => offer({ residencia: "no_cumple", pais: "no_cumple" })));
    expect(s.blockers).toEqual([DONDE]);
  });

  it("los empates se ordenan como mira un reclutador", () => {
    const s = fit(many(5, () => offer({ salario: "no_cumple", modalidad: "no_cumple" })));
    expect(s.blockers.map((b) => b.key)).toEqual(["modalidad", "salario"]);
  });

  it("si domina lo que no sabemos, el titular pide completar el dato", () => {
    const failing = many(2, () => offer({ anos: "no_se_sabe", ingles: "no_cumple" }));
    const passing = many(4, () => offer({ anos: "no_se_sabe", ingles: "cumple" }));
    const s = fit([...failing, ...passing]);
    expect(s.unknowns[0]).toEqual({ key: "anos", label: "Años de experiencia", count: 6 });
    expect(s.headline).toMatch(/^Nos faltan datos tuyos para decirlo: completá «Años/);
  });

  it("separa lo que ya tenés, lo que te falta y lo que no cargaste (null no es 0)", () => {
    const offers = many(5, () => offer({}, ["sql!", "python", "tableau!", "excel"]));
    const s = fit(offers, { sql: 2, python: 0, excel: 1 });
    expect(s.strengths.map((x) => x.slug)).toEqual(["sql"]);
    expect(s.gaps.map((x) => x.slug)).toEqual(["excel", "python"]);
    expect(s.unrated.map((x) => x.slug)).toEqual(["tableau"]);
    expect(s.strengths[0]).toMatchObject({ count: 5, mustCount: 5, level: 2 });
    expect(s.headline).toMatch(/Lo que más piden y te falta es excel\.$/);
  });

  it("una skill que pide una sola oferta no entra en ninguna lista", () => {
    const offers = [offer({}, ["rust"]), ...many(5, () => offer({}))];
    const s = fit(offers, { rust: 0 });
    expect([...s.gaps, ...s.unrated]).toEqual([]);
  });

  it("«te sobra» solo con 10 ofertas o más y con datos del mercado", () => {
    const market = new Map(Object.entries({ cobol: 0.01, sql: 0.4 }));
    const lv = { cobol: 3, sql: 2 };
    const nine = many(9, () => offer({}, ["sql"]));
    expect(fit(nine, lv, market).surplus).toEqual([]);
    const ten = many(10, () => offer({}, ["sql"]));
    expect(fit(ten, lv, null).surplus).toEqual([]);
    const cobol = { slug: "cobol", name: "cobol", level: 3 };
    expect(fit(ten, lv, market).surplus).toEqual([cobol]);
  });

  it("sin frenos ni faltantes, el titular es el de «cumplís»", () => {
    const offers = many(5, () => offer({ ingles: "cumple" }, ["sql"]));
    const s = fit(offers, { sql: 3 });
    expect(s.headline).toBe("Cumplís lo que piden la mayoría de tus ofertas.");
  });

  it("los textos no usan jerga del evaluador", () => {
    const mixed = offer({ ingles: "no_cumple", anos: "no_se_sabe" }, ["sql"]);
    const s = fit(many(6, () => mixed));
    const labels = [...s.blockers, ...s.unknowns].map((g) => g.label);
    const jargon = [s.headline, ...labels].filter((t) => /score|ponderad|bloqueador/i.test(t));
    expect(jargon).toEqual([]);
  });
});

describe("fitCrossSentence (C-6 E4b): la línea de cruce del detalle", () => {
  const summary = (smallSample: boolean): FitSummary => ({
    basis: { offers: 20, withChecklist: 20, smallSample },
    blockers: [
      { key: "ingles", label: "Inglés", count: 9 },
      { key: "anos", label: "Años de experiencia", count: 4 },
    ],
    unknowns: [],
    strengths: [],
    gaps: [],
    unrated: [],
    surplus: [],
    headline: "",
  });

  it("si el descarte de la oferta es tu freno más común, lo dice en «N de M»", () => {
    const line = fitCrossSentence(summary(false), "ingles");
    expect(line).toBe("Esto mismo te pasa en 9 de tus 20 ofertas.");
  });

  it("residencia y país cuentan como el mismo freno", () => {
    const s = summary(false);
    s.blockers = [{ key: "donde", label: "Desde dónde se puede trabajar", count: 7 }];
    const lines = ["pais", "residencia"].map((id) => fitCrossSentence(s, id));
    expect(lines).toEqual([
      "Esto mismo te pasa en 7 de tus 20 ofertas.",
      "Esto mismo te pasa en 7 de tus 20 ofertas.",
    ]);
  });

  it("sin línea si no es el freno más común, si no hay descarte o con base chica", () => {
    expect(fitCrossSentence(summary(false), "anos")).toBeNull();
    expect(fitCrossSentence(summary(false), null)).toBeNull();
    expect(fitCrossSentence(summary(true), "ingles")).toBeNull();
  });
});
