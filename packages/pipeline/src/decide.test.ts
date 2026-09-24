import { describe, expect, it } from "vitest";
import criteria from "../../db/seeds/criteria.example.json";
import type { CriteriaRules } from "./criteria";
import { decide, decideAction } from "./decide";
import type { Evaluation } from "./evaluation";

const rules = criteria as CriteriaRules;

describe("decideAction (tabla del prompt v1.1)", () => {
  it("bloqueadores_duros no vacío → descartar, aunque el score sea alto", () => {
    expect(decideAction(9.5, ["presencial"])).toBe("descartar");
    expect(decideAction(7, ["8+ años"], undefined, ["LATAM sin países"])).toBe("descartar");
  });

  it("riesgos + score ≥ 7 → aplicar (nunca personalizado)", () => {
    expect(decideAction(7, [], undefined, ["país no listado"])).toBe("aplicar");
    expect(decideAction(9.5, [], undefined, ["LATAM sin países"])).toBe("aplicar");
  });

  it("riesgos + score entre 5 y 6.9 → guardar", () => {
    expect(decideAction(5, [], undefined, ["salario no publicado"])).toBe("guardar");
    expect(decideAction(6.9, [], undefined, ["staffing"])).toBe("guardar");
  });

  it("sin bloqueadores + score ≥ 9 → aplicar_personalizado", () => {
    expect(decideAction(9, [])).toBe("aplicar_personalizado");
    expect(decideAction(10, [])).toBe("aplicar_personalizado");
  });

  it("sin bloqueadores + score ≥ 7 → aplicar", () => {
    expect(decideAction(7, [])).toBe("aplicar");
    expect(decideAction(8.9, [])).toBe("aplicar");
  });

  it("sin bloqueadores + score entre 5 y 6.9 → guardar", () => {
    expect(decideAction(5, [])).toBe("guardar");
    expect(decideAction(6.9, [])).toBe("guardar");
  });

  it("score < 5 → descartar, con o sin riesgos", () => {
    expect(decideAction(4.9, [])).toBe("descartar");
    expect(decideAction(4.9, [], undefined, ["riesgo"])).toBe("descartar");
    expect(decideAction(0, [])).toBe("descartar");
  });

  it("acepta umbrales de CriteriaRules", () => {
    const t = { personalizado: 8, aplicar: 6, guardar: 4 };
    expect(decideAction(6, [], t)).toBe("aplicar");
    expect(decideAction(8, [], t)).toBe("aplicar_personalizado");
    expect(decideAction(8, [], t, ["riesgo"])).toBe("aplicar");
    expect(decideAction(4, [], t, ["riesgo"])).toBe("guardar");
  });
});

const base: Evaluation = {
  score: 8,
  confianza: "alta",
  years_required: 4,
  location_ok: "ok",
  modalidad: "remoto",
  disciplina: "ai_engineer",
  ingles_requerido: "intermedio",
  tipo_empresa: "producto",
  paises_permitidos: ["AR"],
  match_fuerte: ["RAG"],
  gaps: [],
  bloqueadores_duros: [],
  senales_positivas: [],
  veredicto: "ok",
  accion_sugerida: "aplicar",
  riesgos: [],
  years_domain: null,
  years_discipline: null,
};

describe("decide(): cap, penalizaciones verificables y riesgos del prefiltro", () => {
  it("sin ajustes: score del modelo → aplicar", () => {
    const d = decide(base, rules);
    expect(d).toMatchObject({ scoreModel: 8, scoreFinal: 8, accion: "aplicar", adjustments: [] });
  });

  it("cap de título del prefiltro: 8 con cap 5 → 5 → guardar", () => {
    const d = decide(base, rules, { titleCap: 5 });
    expect(d.scoreFinal).toBe(5);
    expect(d.accion).toBe("guardar");
    expect(d.adjustments[0]).toMatchObject({ rule: "title_cap", delta: -3 });
  });

  it("años ≥ 8 → bloqueador aunque el modelo no lo haya puesto → descartar", () => {
    const d = decide({ ...base, years_required: 8 }, rules);
    expect(d.bloqueadores).toEqual(["años requeridos ≥ 8 (8)"]);
    expect(d.accion).toBe("descartar");
    // si el modelo ya lo dijo, no se duplica
    const dup = decide({ ...base, years_required: 10, bloqueadores_duros: ["10+ años"] }, rules);
    expect(dup.bloqueadores).toEqual(["10+ años"]);
  });

  it("años 5–7 → −2 (years_penalty): 8 → 6 → guardar", () => {
    const d = decide({ ...base, years_required: 6 }, rules);
    expect(d.scoreFinal).toBe(6);
    expect(d.accion).toBe("guardar");
    expect(d.adjustments.map((a) => a.rule)).toEqual(["years_penalty"]);
  });

  it("gap must de cloud → −1; deseable no resta", () => {
    const must = decide({ ...base, gaps: [{ skill: "AWS (EKS)", nivel: "must" }] }, rules);
    expect(must.scoreFinal).toBe(7);
    expect(must.adjustments[0]?.rule).toBe("cloud_must_penalty");
    const nice = decide({ ...base, gaps: [{ skill: "AWS", nivel: "deseable" }] }, rules);
    expect(nice.scoreFinal).toBe(8);
  });

  it("inglés avanzado/nativo → −1", () => {
    expect(decide({ ...base, ingles_requerido: "avanzado" }, rules).scoreFinal).toBe(7);
    expect(decide({ ...base, ingles_requerido: "nativo" }, rules).scoreFinal).toBe(7);
    expect(decide({ ...base, ingles_requerido: "no_menciona" }, rules).scoreFinal).toBe(8);
  });

  it("penalizaciones se acumulan y el score no baja de 0", () => {
    const d = decide(
      {
        ...base,
        score: 2,
        years_required: 7,
        ingles_requerido: "nativo",
        gaps: [{ skill: "Kubernetes", nivel: "must" }],
      },
      rules,
    );
    expect(d.scoreFinal).toBe(0);
    expect(d.accion).toBe("descartar");
  });

  it("flags del prefiltro → riesgos (sin duplicar) y bajan personalizado a aplicar", () => {
    const d = decide({ ...base, score: 9.5 }, rules, { prefilterFlags: ["location_risk"] });
    expect(d.riesgos).toHaveLength(1);
    expect(d.accion).toBe("aplicar");
    const dup = decide({ ...base, score: 9.5, riesgos: ["país del candidato no listado"] }, rules, {
      prefilterFlags: ["location_risk"],
    });
    expect(dup.riesgos).toHaveLength(1);
  });

  it("location_ok distinto de ok sin riesgo del modelo → se agrega como riesgo", () => {
    const d = decide({ ...base, location_ok: "riesgo" }, rules);
    expect(d.riesgos).toEqual(["location_ok = riesgo"]);
    expect(d.accion).toBe("aplicar");
  });

  it("location_ok = no (país excluido) → tope guardar aunque el score dé aplicar", () => {
    // Empresa Z (golden 32): match 8, aviso original sin Argentina → el humano guardó
    const d = decide({ ...base, score: 8, location_ok: "no" }, rules);
    expect(d.riesgos).toEqual(["location_ok = no"]);
    expect(d.accion).toBe("guardar");
    // Con score bajo o bloqueador sigue siendo descartar; con riesgo (no "no") sigue aplicar
    expect(decide({ ...base, score: 4, location_ok: "no" }, rules).accion).toBe("descartar");
    expect(decide({ ...base, score: 9.5, location_ok: "no" }, rules).accion).toBe("guardar");
  });
});

describe("decide(): disciplina fuera del perfil (JS-052)", () => {
  it("disciplina no permitida → bloqueador, tope de score y descartar", () => {
    const d = decide({ ...base, score: 7.5, disciplina: "creative_production" }, rules);
    expect(d.bloqueadores).toEqual(["disciplina distinta (creative_production)"]);
    expect(d.scoreFinal).toBe(4);
    expect(d.accion).toBe("descartar");
    expect(d.adjustments.map((a) => a.rule)).toContain("discipline_cap");
  });

  it("el tope nunca sube un score que ya está abajo", () => {
    const d = decide({ ...base, score: 2, disciplina: "ml_engineer" }, rules);
    expect(d.scoreFinal).toBe(2);
    expect(d.adjustments.map((a) => a.rule)).not.toContain("discipline_cap");
  });

  it("si el modelo ya puso el bloqueador, no se duplica", () => {
    const d = decide(
      {
        ...base,
        disciplina: "ai_evaluation",
        bloqueadores_duros: ["disciplina distinta (ai_evaluation)"],
      },
      rules,
    );
    expect(d.bloqueadores).toEqual(["disciplina distinta (ai_evaluation)"]);
  });

  it("disciplinas del perfil (ai_engineer, fullstack, frontend, backend, arquitectura) no bloquean", () => {
    for (const disciplina of [
      "ai_engineer",
      "fullstack",
      "frontend",
      "backend",
      "arquitectura",
    ] as const) {
      const d = decide({ ...base, disciplina }, rules);
      expect(d.bloqueadores, disciplina).toEqual([]);
      expect(d.scoreFinal, disciplina).toBe(8);
    }
  });

  it("B4: bloqueador de disciplina que contradice al campo disciplina → se descarta (falso positivo Niuro)", () => {
    // Niuro en producción: score 7, disciplina fullstack, bloqueador "disciplina distinta (lead)".
    // "lead" es seniority, no disciplina: el campo tipado manda.
    const d = decide(
      {
        ...base,
        score: 7,
        disciplina: "fullstack",
        bloqueadores_duros: ["disciplina distinta (lead)"],
      },
      rules,
    );
    expect(d.bloqueadores).toEqual([]);
    expect(d.accion).toBe("aplicar");
    // pero no toca bloqueadores de otro tipo
    const otro = decide(
      { ...base, disciplina: "fullstack", bloqueadores_duros: ["modalidad presencial"] },
      rules,
    );
    expect(otro.bloqueadores).toEqual(["modalidad presencial"]);
  });
});

describe("decide(): inglés exigido por encima del candidato (JS-052)", () => {
  it("avanzado con candidato B1 → riesgo explícito, además de la penalización de −1", () => {
    const d = decide({ ...base, ingles_requerido: "avanzado" }, rules, {
      candidateEnglishCefr: "B1",
    });
    expect(d.riesgos).toEqual(["inglés requerido avanzado, el candidato tiene B1"]);
    expect(d.scoreFinal).toBe(7);
    expect(d.accion).toBe("aplicar"); // el riesgo no frena: Steuart sigue en aplicar
    expect(d.bloqueadores).toEqual([]);
  });

  it("nativo con candidato B1 → riesgo", () => {
    const d = decide({ ...base, ingles_requerido: "nativo" }, rules, {
      candidateEnglishCefr: "B1",
    });
    expect(d.riesgos).toHaveLength(1);
  });

  it("candidato al nivel exigido o por encima → sin riesgo", () => {
    expect(
      decide({ ...base, ingles_requerido: "avanzado" }, rules, { candidateEnglishCefr: "C1" })
        .riesgos,
    ).toEqual([]);
    expect(
      decide({ ...base, ingles_requerido: "intermedio" }, rules, { candidateEnglishCefr: "B1" })
        .riesgos,
    ).toEqual([]);
  });

  it("sin CEFR del candidato no se inventa el riesgo", () => {
    expect(decide({ ...base, ingles_requerido: "avanzado" }, rules).riesgos).toEqual([]);
  });

  it("no duplica si el modelo ya reportó el riesgo de inglés", () => {
    const d = decide(
      {
        ...base,
        ingles_requerido: "avanzado",
        riesgos: ["Nivel de inglés del candidato (B1) es inferior al requerido (C1)"],
      },
      rules,
      { candidateEnglishCefr: "B1" },
    );
    expect(d.riesgos).toHaveLength(1);
  });
});

describe("decide(): gap de años contra el perfil (JS-052)", () => {
  // El perfil real de Mauro pasó a 2 años. Las reglas absolutas (≥ 8 bloquea, 5–7 resta 2) no se
  // tocan: son su propio criterio en el golden. El gap solo agrega un riesgo, nunca baja el score.
  const ctx = { candidateYearsTotal: 2 };

  it("gap ≥ 1 → riesgo con el texto del gap, sin tocar el score ni la acción", () => {
    const d = decide({ ...base, score: 7, years_required: 3 }, rules, ctx);
    expect(d.riesgos).toEqual(["pide 3 años, tenés 2"]);
    expect(d.scoreFinal).toBe(7);
    expect(d.accion).toBe("aplicar");
    expect(d.adjustments).toEqual([]);
  });

  it("pedir lo mismo o menos que el candidato no es riesgo", () => {
    expect(decide({ ...base, years_required: 2 }, rules, ctx).riesgos).toEqual([]);
    expect(decide({ ...base, years_required: 1 }, rules, ctx).riesgos).toEqual([]);
    expect(decide({ ...base, years_required: null }, rules, ctx).riesgos).toEqual([]);
  });

  it("sin años del candidato en el contexto no se inventa el riesgo", () => {
    expect(decide({ ...base, years_required: 5 }, rules).riesgos).toEqual([]);
  });

  it("no pisa la penalización 5–7 ni el bloqueador ≥ 8, que siguen siendo absolutos", () => {
    // 5 años: −2 como siempre, más el riesgo del gap
    const cinco = decide({ ...base, years_required: 5 }, rules, ctx);
    expect(cinco.scoreFinal).toBe(6);
    expect(cinco.adjustments.map((a) => a.rule)).toEqual(["years_penalty"]);
    expect(cinco.riesgos).toEqual(["pide 5 años, tenés 2"]);
    // 8 años: bloqueador; el riesgo del gap sobra y no se agrega
    const ocho = decide({ ...base, years_required: 8 }, rules, ctx);
    expect(ocho.bloqueadores).toEqual(["años requeridos ≥ 8 (8)"]);
    expect(ocho.riesgos).toEqual([]);
    expect(ocho.accion).toBe("descartar");
  });

  it("no duplica si el modelo ya reportó el gap de años", () => {
    const d = decide(
      { ...base, years_required: 4, riesgos: ["Pide 4 años y el candidato tiene 2"] },
      rules,
      ctx,
    );
    expect(d.riesgos).toHaveLength(1);
  });

  it("parametrizable: con penalty_from y blocker_from configurados, resta y bloquea", () => {
    const duras = {
      ...rules,
      years_gap: { risk_from: 1, penalty_from: 2, penalty: 0.5, blocker_from: 3 },
    };
    const gap1 = decide({ ...base, score: 8, years_required: 3 }, duras, ctx);
    expect(gap1.riesgos).toEqual(["pide 3 años, tenés 2"]);
    expect(gap1.scoreFinal).toBe(8);

    const gap2 = decide({ ...base, score: 8, years_required: 4 }, duras, ctx);
    expect(gap2.scoreFinal).toBe(7.5);
    expect(gap2.adjustments.map((a) => a.rule)).toContain("years_gap_penalty");

    const gap3 = decide({ ...base, score: 8, years_required: 5 }, duras, ctx);
    expect(gap3.bloqueadores).toEqual(["gap de años: pide 5, el candidato tiene 2"]);
    expect(gap3.accion).toBe("descartar");
  });
});

describe("decide(): años de otra disciplina (JS-052)", () => {
  it("años de una disciplina ajena al perfil → bloqueador con el dominio del aviso", () => {
    // Pencil GenAI Creator: "2-3 years' experience in advertising creative development"
    const d = decide(
      {
        ...base,
        score: 7.5,
        years_required: 2,
        years_domain: "advertising creative development",
        years_discipline: "creative_production",
      },
      rules,
      { candidateYearsTotal: 2 },
    );
    expect(d.bloqueadores).toContain("años en otro dominio (advertising creative development)");
    expect(d.accion).toBe("descartar");
  });

  it("sin years_domain usa la disciplina como nombre del dominio", () => {
    const d = decide(
      { ...base, years_required: 3, years_domain: null, years_discipline: "ml_engineer" },
      rules,
    );
    expect(d.bloqueadores).toContain("años en otro dominio (ml_engineer)");
  });

  it("años de una disciplina del perfil no bloquean (Steuart: software development)", () => {
    const d = decide(
      {
        ...base,
        score: 8.5,
        years_required: 3,
        years_domain: "professional software development",
        years_discipline: "fullstack",
      },
      rules,
      { candidateYearsTotal: 2, candidateEnglishCefr: "B1" },
    );
    expect(d.bloqueadores).toEqual([]);
    expect(d.accion).toBe("aplicar");
  });

  it("versiones de prompt sin el campo (≤ v1.3.1) no bloquean por dominio", () => {
    const d = decide({ ...base, years_required: 3, years_discipline: null }, rules);
    expect(d.bloqueadores).toEqual([]);
  });

  it("si el modelo ya lo puso, no se duplica", () => {
    const d = decide(
      {
        ...base,
        years_required: 2,
        years_domain: "advertising creative",
        years_discipline: "creative_production",
        bloqueadores_duros: ["años en otro dominio (publicidad)"],
      },
      rules,
    );
    expect(d.bloqueadores.filter((b) => /otro dominio/i.test(b))).toHaveLength(1);
  });
});
