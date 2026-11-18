import type { CvIssue } from "@job-search-os/pipeline";
import { describe, expect, it } from "vitest";
import { loadCvCoachGolden, TAXONOMY } from "./golden";
import {
  aggregateMetrics,
  checkCvCoachThresholds,
  conversationMetrics,
  diagnosisScores,
  inventions,
  inventionSources,
  issueAlreadyAddressed,
  lostFacts,
  repeatedQuestions,
  type ConversationRecord,
  type QuestionLog,
} from "./metrics";

const f = loadCvCoachGolden({ ids: ["con-experiencia"] })[0]!.fixture;
const id = (clave: string) => f.lectura.items.find((i) => i.clave === clave)!.id;
const sources = inventionSources(f, ["Bajé el cierre mensual de 8 a 5 días hábiles."], TAXONOMY);

const issue = (n: number, over: Partial<CvIssue>): CvIssue => ({
  id: `iss:${n}`,
  type: "logro_sin_resultado",
  ref: { section: "experience", itemId: id("exp-1"), field: null },
  quote: null,
  skillSlug: null,
  severity: "media",
  source: "model",
  ...over,
});

const q = (over: Partial<QuestionLog>): QuestionLog => ({
  issueId: "iss:1",
  type: "logro_sin_resultado",
  text: "¿Qué lograste?",
  source: "fallback",
  followUp: false,
  alreadyComplete: false,
  ...over,
});

describe("invenciones (verificador de ADR-026 contra el CV y las respuestas)", () => {
  it("una viñeta con un número, una herramienta o un nombre que nadie dijo cuenta como invención", () => {
    expect(inventions(["Bajé el cierre mensual de 8 a 5 días hábiles."], sources)).toBe(0);
    expect(inventions(["Bajé el cierre mensual un 40 %."], sources)).toBe(1);
    expect(inventions(["Automaticé los cierres con Python."], sources)).toBe(1);
    expect(inventions(["Lideré el equipo de Empresa Z."], sources)).toBe(1);
  });

  it("el rótulo fijo «Stack:» del cierre no es invención; lo que sigue sí se verifica", () => {
    expect(inventions(["Stack: Excel, Power BI"], sources)).toBe(0);
    expect(inventions(["Stack: Excel, Tableau"], sources)).toBe(1);
  });

  it("el puesto objetivo y las skills confirmadas cuentan como fuente (entran a cv_write)", () => {
    expect(inventions([`${f.puesto_objetivo} con experiencia en cierres.`], sources)).toBe(0);
  });
});

describe("datos perdidos", () => {
  it("un hecho del CV que no aparece en el CV final se pierde; los de respuesta cuentan solo si se dijeron", () => {
    const fullCv = [f.cv_texto, "8 a 5 días", "40 proveedores"];
    expect(lostFacts(f, [], fullCv)).toMatchObject({ lost: 0 });
    const withoutC = fullCv.map((l) => l.replace(/Empresa C/g, "Empresa"));
    expect(lostFacts(f, [], withoutC).keys).toContain("empresa");
    const notSaid = lostFacts(f, [], [f.cv_texto]);
    const said = lostFacts(f, ["Bajé el cierre mensual de 8 a 5 días hábiles."], [f.cv_texto]);
    expect(said.total).toBeGreaterThan(notSaid.total);
    expect(said.lost).toBeGreaterThan(notSaid.lost);
  });
});

describe("preguntas repetidas", () => {
  it("cuenta las que piden algo ya completo y las que repiten el texto de otra sobre otro problema", () => {
    expect(
      repeatedQuestions([
        q({}),
        q({ issueId: "iss:2", alreadyComplete: true }),
        q({ issueId: "iss:3", text: "¿Qué lograste?" }),
        q({ issueId: "iss:1", followUp: true, text: "¿Qué lograste?" }),
      ]),
    ).toBe(2);
  });

  it("una fecha ya cargada, un proyecto con link o una skill que ya se ve en un trabajo están completos", () => {
    const items = f.lectura.items;
    expect(issueAlreadyAddressed(issue(1, { type: "fecha_faltante" }), items, TAXONOMY)).toBe(true);
    const powerBi = issue(2, {
      type: "skill_pedida_sin_evidencia",
      skillSlug: "power_bi",
      ref: { section: "skills", itemId: "power_bi", field: null },
    });
    expect(issueAlreadyAddressed(powerBi, items, TAXONOMY)).toBe(false);
    const shown = items.map((i) =>
      i.clave === "exp-1" ? { ...i, bullets: [...i.bullets, "Tableros en Power BI."] } : i,
    );
    expect(issueAlreadyAddressed(powerBi, shown, TAXONOMY)).toBe(true);
  });
});

describe("diagnóstico", () => {
  it("recall y precisión contra problemas_esperados, por tipo e ítem o skill", () => {
    const issues = [
      issue(1, {}),
      issue(2, {
        type: "brecha_con_puesto",
        skillSlug: "erp_accounting",
        ref: { section: "skills", itemId: "erp_accounting", field: null },
        source: "data",
      }),
      issue(3, {
        type: "tarea_vaga",
        ref: { section: "experience", itemId: id("exp-1"), field: null },
      }),
    ];
    const s = diagnosisScores(issues, f);
    expect(s.hits).toBe(2);
    expect(s.recall).toBeCloseTo(2 / f.problemas_esperados.length);
    expect(s.precision).toBeCloseTo(2 / 3);
    expect(diagnosisScores([], f).precision).toBeNull();
  });
});

describe("agregado y umbrales", () => {
  const rec = (over: Partial<ConversationRecord>): ConversationRecord => ({
    fixtureId: f.id,
    issues: f.problemas_esperados.map((e, n) =>
      "skill" in e
        ? issue(n + 1, {
            type: e.tipo,
            skillSlug: e.skill,
            ref: { section: "skills", itemId: e.skill, field: null },
          })
        : issue(n + 1, {
            type: e.tipo,
            ref: { section: "experience", itemId: e.item ? id(e.item) : null, field: null },
          }),
    ),
    questions: [q({})],
    answers: [],
    finalCv: [f.cv_texto],
    finalWritten: [],
    resolved: ["iss:1"],
    skipped: [],
    turns: 1,
    calls: 3,
    costUsd: 0.1,
    ms: 10,
    closeReason: "lista_agotada",
    ...over,
  });

  it("una charla limpia pasa; una invención sola alcanza para no pasar (bloqueante)", () => {
    const ok = aggregateMetrics([conversationMetrics(rec({}), f, TAXONOMY)]);
    expect(checkCvCoachThresholds(ok, { measuresCost: true }).ok).toBe(true);
    const bad = aggregateMetrics([
      conversationMetrics(rec({ finalWritten: ["Bajé costos un 99 %."] }), f, TAXONOMY),
    ]);
    const check = checkCvCoachThresholds(bad, { measuresCost: true });
    expect(check.ok).toBe(false);
    expect(check.failures[0]).toMatch(/invenciones: 1/);
  });

  it("lo que no se midió no pasa, y el costo solo se evalúa con el modelo real", () => {
    const empty = aggregateMetrics([]);
    expect(checkCvCoachThresholds(empty, { measuresCost: false }).ok).toBe(false);
    const pricey = aggregateMetrics([conversationMetrics(rec({ costUsd: 0.5 }), f, TAXONOMY)]);
    expect(checkCvCoachThresholds(pricey, { measuresCost: false }).ok).toBe(true);
    expect(checkCvCoachThresholds(pricey, { measuresCost: true }).failures.join()).toMatch(
      /costo típico/,
    );
  });

  it("en la etapa de diagnóstico solo cuentan recall y precisión", () => {
    const m = aggregateMetrics([
      conversationMetrics(rec({ finalWritten: ["Bajé costos un 99 %."] }), f, TAXONOMY),
    ]);
    expect(checkCvCoachThresholds(m, { measuresCost: true, stage: "diagnostico" }).ok).toBe(true);
  });
});
