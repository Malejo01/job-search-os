import { describe, expect, it } from "vitest";
import criteria from "../../db/seeds/criteria.example.json";
import type { CriteriaRules } from "./criteria";
import { decide, decideAction } from "./decide";
import type { Evaluation } from "./evaluation";
import { INJECTION_FLAG, INJECTION_RISK } from "./evaluator/injection";
import { prefilter } from "./prefilter";

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

  it("B4: bloqueador de disciplina que contradice al campo disciplina → se descarta (falso positivo de produccion)", () => {
    // Caso de producción: score 7, disciplina fullstack, bloqueador "disciplina distinta (lead)".
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
  // Perfil ficticio: su nivel queda por debajo de "avanzado" y "nativo".
  const PERFIL_FICTICIO = { english: "B2" };

  it("avanzado con candidato por debajo de lo exigido → riesgo explícito, además de la penalización de −1", () => {
    const d = decide({ ...base, ingles_requerido: "avanzado" }, rules, {
      candidateEnglishCefr: PERFIL_FICTICIO.english,
    });
    expect(d.riesgos).toEqual([
      `inglés requerido avanzado, el candidato tiene ${PERFIL_FICTICIO.english}`,
    ]);
    expect(d.scoreFinal).toBe(7);
    expect(d.accion).toBe("aplicar"); // el riesgo no frena: Empresa AD (golden 36) sigue en aplicar
    expect(d.bloqueadores).toEqual([]);
  });

  it("nativo con candidato por debajo de lo exigido → riesgo", () => {
    const d = decide({ ...base, ingles_requerido: "nativo" }, rules, {
      candidateEnglishCefr: PERFIL_FICTICIO.english,
    });
    expect(d.riesgos).toHaveLength(1);
  });

  it("candidato al nivel exigido o por encima → sin riesgo", () => {
    expect(
      decide({ ...base, ingles_requerido: "avanzado" }, rules, { candidateEnglishCefr: "C1" })
        .riesgos,
    ).toEqual([]);
    expect(
      decide({ ...base, ingles_requerido: "intermedio" }, rules, {
        candidateEnglishCefr: PERFIL_FICTICIO.english,
      }).riesgos,
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
        riesgos: ["Nivel de inglés del candidato (B2) es inferior al requerido (C1)"],
      },
      rules,
      { candidateEnglishCefr: PERFIL_FICTICIO.english },
    );
    expect(d.riesgos).toHaveLength(1);
  });
});

describe("decide(): penalización de inglés según el CEFR de la persona", () => {
  const score = (req: Evaluation["ingles_requerido"], cefr?: string | null) =>
    decide({ ...base, ingles_requerido: req }, rules, { candidateEnglishCefr: cefr }).scoreFinal;

  it("C1 contra avanzado: sin penalización", () => expect(score("avanzado", "C1")).toBe(8));
  it("B2 contra avanzado: con penalización", () => expect(score("avanzado", "B2")).toBe(7));
  it("C1 contra nativo: con penalización", () => expect(score("nativo", "C1")).toBe(7));
  it("C2 contra nativo: sin penalización", () => expect(score("nativo", "C2")).toBe(8));
  it("sin CEFR (o ilegible): con penalización, como antes", () => {
    expect(score("avanzado")).toBe(7);
    expect(score("avanzado", null)).toBe(7);
    expect(score("nativo", "?")).toBe(7);
  });
  it("con penalización 0 (criterios neutros) nunca resta", () => {
    const neutral = { ...rules, english_fluent_penalty: 0 };
    expect(decide({ ...base, ingles_requerido: "nativo" }, neutral).scoreFinal).toBe(8);
  });
});

describe("decide(): flag modalidad_no_remota del prefiltro", () => {
  it("agrega el riesgo de modalidad y baja personalizado a aplicar", () => {
    const d = decide({ ...base, score: 9.5 }, rules, { prefilterFlags: ["modalidad_no_remota"] });
    expect(d.riesgos).toEqual(["modalidad híbrida o presencial"]);
    expect(d.accion).toBe("aplicar");
  });
  it("no duplica si el modelo ya lo reportó", () => {
    const d = decide({ ...base, riesgos: ["Modalidad híbrida en Buenos Aires"] }, rules, {
      prefilterFlags: ["modalidad_no_remota"],
    });
    expect(d.riesgos).toHaveLength(1);
  });
});

describe("decide(): flag ciudad_distinta del prefiltro", () => {
  it("agrega el riesgo sin bajar el score ni la acción, y no se duplica", () => {
    const sin = decide({ ...base, score: 9.5 }, rules);
    const d = decide({ ...base, score: 9.5 }, rules, { prefilterFlags: ["ciudad_distinta"] });
    expect(d.riesgos).toEqual(["La oferta parece ser en otra ciudad que la de tu perfil"]);
    expect(d.scoreFinal).toBe(sin.scoreFinal);
    const dup = decide({ ...base, riesgos: ["Está en otra ciudad"] }, rules, {
      prefilterFlags: ["ciudad_distinta"],
    });
    expect(dup.riesgos).toHaveLength(1);
  });
});

describe("decide(): modalidad aceptada (ronda 84)", () => {
  const hibrido: Evaluation = {
    ...base,
    modalidad: "hibrido",
    bloqueadores_duros: ["Modalidad híbrida"],
  };
  const todas = ["remoto", "hibrido", "presencial"] as const;

  it("acepta híbrido: el bloqueador pasa a riesgo y la acción sale del score", () => {
    const d = decide(hibrido, rules, { acceptedModalities: todas });
    expect(d.bloqueadores).toEqual([]);
    expect(d.riesgos).toEqual(["Modalidad híbrida"]);
    expect(d.accion).toBe("aplicar");
  });
  it("solo remoto: sigue descartando", () => {
    const d = decide(hibrido, rules, { acceptedModalities: ["remoto"] });
    expect(d.bloqueadores).toEqual(["Modalidad híbrida"]);
    expect(d.accion).toBe("descartar");
  });
  it("sin acceptedModalities: idéntico a hoy", () => {
    const d = decide(hibrido, rules);
    expect(d.bloqueadores).toEqual(["Modalidad híbrida"]);
    expect(d.riesgos).toEqual([]);
    expect(d.accion).toBe("descartar");
  });
  it("un bloqueador mixto (jornada presencial de 48 hs) se conserva", () => {
    const e: Evaluation = {
      ...base,
      modalidad: "presencial",
      bloqueadores_duros: ["jornada presencial de 48 hs"],
    };
    const d = decide(e, rules, { acceptedModalities: todas });
    expect(d.bloqueadores).toEqual(["jornada presencial de 48 hs"]);
    expect(d.accion).toBe("descartar");
  });
  it("modalidad remoto con 'primera semana en oficina': riesgo si acepta híbrido, bloqueador si no", () => {
    const e: Evaluation = { ...base, bloqueadores_duros: ["Primera semana en oficina"] };
    const acepta = decide(e, rules, { acceptedModalities: ["remoto", "hibrido"] });
    expect(acepta.bloqueadores).toEqual([]);
    expect(acepta.riesgos).toEqual(["Primera semana en oficina"]);
    const no = decide(e, rules, { acceptedModalities: ["remoto"] });
    expect(no.bloqueadores).toEqual(["Primera semana en oficina"]);
  });
  it.each([
    "Relocation obligatoria a una oficina en otro país",
    "Visa de trabajo requerida, trabajo presencial",
    "Otra disciplina del oficio, presencial en oficina",
    "Modalidad de contratación: dependencia",
    "Entrevista presencial obligatoria",
    "Infraestructura en nube híbrida",
    "Paquete oficina de Microsoft",
    "Debe mudarse a la oficina central",
    "Inglés avanzado, presencial",
    "Visitas mensuales a clientes en el exterior",
    "Presencial en otro país (España)",
    "On-site abroad",
  ])("no mueve un bloqueador que no es solo modalidad: %s", (texto) => {
    const e: Evaluation = { ...base, modalidad: "presencial", bloqueadores_duros: [texto] };
    const d = decide(e, rules, { acceptedModalities: todas });
    expect(d.bloqueadores).toEqual([texto]);
    expect(d.accion).toBe("descartar");
  });
  it("'Presencial 5 días en Madrid' baja a riesgo: sin señal de país en el texto no hay regla limpia", () => {
    // Limitación conocida: el país lo cubren location_ok y el prefiltro, no esta regla.
    const e: Evaluation = {
      ...base,
      modalidad: "presencial",
      bloqueadores_duros: ["Presencial 5 días en Madrid"],
    };
    const d = decide(e, rules, { acceptedModalities: todas });
    expect(d.bloqueadores).toEqual([]);
    expect(d.riesgos).toEqual(["Presencial 5 días en Madrid"]);
  });
  it("un bloqueador que nombra una modalidad no aceptada no se mueve", () => {
    const e: Evaluation = {
      ...base,
      modalidad: "remoto",
      bloqueadores_duros: ["Presencial 5 días"],
    };
    const d = decide(e, rules, { acceptedModalities: ["remoto", "hibrido"] });
    expect(d.bloqueadores).toEqual(["Presencial 5 días"]);
  });
  it("'Presencial en otra ciudad' pasa a riesgo y con ciudad_distinta no se duplica", () => {
    const e: Evaluation = {
      ...base,
      modalidad: "presencial",
      bloqueadores_duros: ["Presencial en otra ciudad"],
    };
    const d = decide(e, rules, {
      acceptedModalities: todas,
      prefilterFlags: ["modalidad_no_remota", "ciudad_distinta"],
    });
    expect(d.bloqueadores).toEqual([]);
    expect(d.riesgos.filter((r) => /otra ciudad/i.test(r))).toHaveLength(1);
  });
  it("dos bloqueadores de modalidad pasan a riesgos los dos", () => {
    const e: Evaluation = {
      ...base,
      modalidad: "hibrido",
      bloqueadores_duros: ["Modalidad híbrida", "Dos días en oficina"],
      riesgos: ["modalidad híbrida"],
    };
    const d = decide(e, rules, { acceptedModalities: todas });
    expect(d.bloqueadores).toEqual([]);
    expect(d.riesgos).toEqual(["modalidad híbrida", "Dos días en oficina"]);
  });
  it("con ciudad_distinta el riesgo de ciudad aparece una sola vez", () => {
    const d = decide(hibrido, rules, {
      acceptedModalities: todas,
      prefilterFlags: ["modalidad_no_remota", "ciudad_distinta"],
    });
    expect(d.bloqueadores).toEqual([]);
    expect(d.riesgos.filter((r) => /otra ciudad/i.test(r))).toHaveLength(1);
    expect(d.riesgos.filter((r) => /h[ií]brid|presencial|modalidad/i.test(r))).toHaveLength(1);
  });
});

describe("decide(): gap de años contra el perfil (JS-052)", () => {
  // Las reglas absolutas (≥ 8 bloquea, 5–7 resta 2) no se tocan: son el criterio del golden.
  // El gap solo agrega un riesgo, nunca baja el score.
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
    // Empresa V (golden id 35): pide 2-3 años en desarrollo creativo publicitario
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

  it("años de una disciplina del perfil no bloquean (Empresa AD, golden 36: software development)", () => {
    const d = decide(
      {
        ...base,
        score: 8.5,
        years_required: 3,
        years_domain: "professional software development",
        years_discipline: "fullstack",
      },
      rules,
      { candidateYearsTotal: 2, candidateEnglishCefr: "B2" },
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

describe("decide(): reglas nuevas con criterios viejos (orden de deploy)", () => {
  // Si el codigo nuevo sale antes del UPDATE de evaluation_criteria.rules, las reglas de JS-052
  // no existen todavia. Eso tiene que degradar, no tirar el worker abajo.
  const viejas = { ...rules } as Record<string, unknown>;
  delete viejas.allowed_disciplines;
  delete viejas.discipline_cap_score;
  delete viejas.years_gap;
  delete viejas.english_risk_from;
  const sinReglas = viejas as unknown as CriteriaRules;

  it("sin allowed_disciplines no bloquea por disciplina ni rompe", () => {
    const d = decide({ ...base, disciplina: "creative_production" }, sinReglas, {
      candidateEnglishCefr: "B2",
      candidateYearsTotal: 2,
    });
    expect(d.bloqueadores).toEqual([]);
    expect(d.scoreFinal).toBe(8);
    expect(d.accion).toBe("aplicar");
  });

  it("una lista vacía es configuración inválida, no 'todo bloquea'", () => {
    const vacia = { ...rules, allowed_disciplines: [] };
    expect(decide({ ...base, disciplina: "ml_engineer" }, vacia).bloqueadores).toEqual([]);
  });

  it("sin la lista tampoco BORRA el bloqueador del modelo: B4 necesita el campo tipado", () => {
    // Ventana de deploy: codigo nuevo + rules viejas. Perder un bloqueador seria peor que no
    // tener la regla nueva. Con la lista cargada si se cae (es el caso de produccion, testeado arriba).
    const d = decide(
      { ...base, disciplina: "fullstack", bloqueadores_duros: ["disciplina distinta (creativa)"] },
      sinReglas,
    );
    expect(d.bloqueadores).toEqual(["disciplina distinta (creativa)"]);
    expect(d.accion).toBe("descartar");
  });

  it("sin english_risk_from ni years_gap tampoco agrega riesgos", () => {
    const d = decide({ ...base, ingles_requerido: "avanzado", years_required: 5 }, sinReglas, {
      candidateEnglishCefr: "B2",
      candidateYearsTotal: 2,
    });
    expect(d.riesgos).toEqual([]);
  });
});

describe("decide(): aviso con instrucciones al evaluador (ronda 43)", () => {
  const flags = { prefilterFlags: [INJECTION_FLAG] };
  const limpio = { ...base, years_required: null };

  it("sin el flag no cambia nada", () => {
    const d = decide({ ...limpio, score: 9 }, rules);
    expect(d.riesgos).not.toContain(INJECTION_RISK);
    expect(d.adjustments.some((a) => a.rule === "injection_cap")).toBe(false);
    expect(d.accion).toBe("aplicar_personalizado");
  });

  it("con el flag y score 9: riesgo, tope en guardar y acción guardar", () => {
    const d = decide({ ...limpio, score: 9 }, rules, flags);
    expect(d.riesgos).toContain(INJECTION_RISK);
    expect(d.scoreFinal).toBe(rules.thresholds.guardar);
    expect(d.adjustments).toContainEqual({
      rule: "injection_cap",
      delta: rules.thresholds.guardar - 9,
      detail: expect.any(String),
    });
    expect(d.accion).toBe("guardar");
  });

  it("con el flag y score 4: el score no cambia y sigue descartando", () => {
    const d = decide({ ...limpio, score: 4 }, rules, flags);
    expect(d.scoreFinal).toBe(4);
    expect(d.adjustments.some((a) => a.rule === "injection_cap")).toBe(false);
    expect(d.riesgos).toContain(INJECTION_RISK);
    expect(d.accion).toBe("descartar");
  });

  it("no duplica el riesgo si el modelo ya lo puso", () => {
    const d = decide({ ...limpio, score: 8, riesgos: [INJECTION_RISK] }, rules, flags);
    expect(d.riesgos.filter((r) => r === INJECTION_RISK)).toHaveLength(1);
  });

  it("con el flag nunca queda en aplicar ni aplicar_personalizado", () => {
    for (const score of [5, 6, 7, 8, 9, 10]) {
      const d = decide({ ...limpio, score }, rules, flags);
      expect(["aplicar", "aplicar_personalizado"]).not.toContain(d.accion);
    }
  });
});

describe("decide(): residencia exigida (ronda 66)", () => {
  const flags = { prefilterFlags: ["residencia_exigida:CA", "location_risk"] };

  it("con el flag → descartar, bloqueador, adjustment y location_ok efectivo 'no'", () => {
    const d = decide({ ...base, score: 9 }, rules, flags);
    expect(d.accion).toBe("descartar");
    expect(d.bloqueadores).toContain("residencia exigida en CA");
    expect(d.adjustments).toContainEqual(
      expect.objectContaining({ rule: "residencia_exigida", delta: 0 }),
    );
    expect(d.locationOk).toBe("no");
    expect(d.scoreFinal).toBe(9);
  });

  it("lista varios lugares en el bloqueador", () => {
    const d = decide(base, rules, { prefilterFlags: ["residencia_exigida:CA,US,EU"] });
    expect(d.bloqueadores).toContain("residencia exigida en CA, US, EU");
  });

  it("un solo bloqueador de país aunque el modelo ya haya puesto uno", () => {
    const d = decide({ ...base, bloqueadores_duros: ["país excluido: Canadá"] }, rules, flags);
    expect(d.bloqueadores).toEqual(["país excluido: Canadá"]);
    expect(d.accion).toBe("descartar");
  });

  it("sin el flag, location_ok del modelo queda como está", () => {
    expect(decide(base, rules).locationOk).toBe("ok");
    expect(decide({ ...base, location_ok: "riesgo" }, rules).locationOk).toBe("riesgo");
  });

  it("caso Empresa A / Canadá: JD ficticia, perfil AR → descartar", () => {
    const jd = [
      "Empresa A (fintech) busca un Senior Data Analyst.",
      "Remote (Canada). You must be based in Canada to be considered.",
      "Trabajarás con SQL, Python y dashboards para el equipo de riesgo.",
      "Se valora experiencia en pagos.",
    ].join("\n");
    const pre = prefilter(
      {
        title: "Senior Data Analyst",
        companyRaw: "Empresa A",
        locationRaw: "Remote (Canada)",
        modality: "remoto",
        jdText: jd,
      },
      rules,
      { userCountry: "AR" },
    );
    expect(pre.pass).toBe(true);
    const d = decide({ ...base, score: 8.5, location_ok: "ok" }, rules, {
      prefilterFlags: pre.pass ? pre.flags : [],
    });
    expect(d.accion).toBe("descartar");
    expect(d.locationOk).toBe("no");
    expect(d.bloqueadores).toEqual(["residencia exigida en CA"]);
  });
});

describe("decide(): jobFacts, salario (D3, ronda 104)", () => {
  const facts = (f: NonNullable<Parameters<typeof decide>[2]>["jobFacts"]) => ({ jobFacts: f });

  it("máximo mensual por debajo del piso → bloqueador en código (golden 19) → descartar", () => {
    const d = decide(
      { ...base, score: 8 },
      rules,
      facts({ salaryMinUsd: 2400, salaryMaxUsd: 2800, salaryPeriod: "mensual" }),
    );
    expect(d.bloqueadores).toHaveLength(1);
    expect(d.bloqueadores[0]).toMatch(/^salario publicado por debajo del piso/);
    expect(d.accion).toBe("descartar");
  });

  it("anual se divide por 12: 30.000 al año son 2.500 al mes", () => {
    const d = decide(
      base,
      rules,
      facts({ salaryMinUsd: 24000, salaryMaxUsd: 30000, salaryPeriod: "anual" }),
    );
    expect(d.bloqueadores).toHaveLength(1);
    expect(d.bloqueadores[0]).toMatch(/por debajo del piso \(.*2500\/mes/);
    const ok = decide(base, rules, facts({ salaryMaxUsd: 48000, salaryPeriod: "anual" }));
    expect(ok.bloqueadores).toEqual([]);
  });

  it("no duplica si el modelo ya puso un bloqueador de salario", () => {
    const d = decide(
      { ...base, bloqueadores_duros: ["Salario bajo el piso"] },
      rules,
      facts({ salaryMaxUsd: 2000, salaryPeriod: "mensual" }),
    );
    expect(d.bloqueadores).toEqual(["Salario bajo el piso"]);
  });

  it("por hora, sin período o sin cifras: no se sabe, vale lo del modelo (golden 33)", () => {
    for (const f of [
      { salaryMinUsd: 100, salaryMaxUsd: 150, salaryPeriod: "hora" },
      { salaryMaxUsd: 150, salaryPeriod: null },
      { salaryPeriod: "mensual" },
    ]) {
      const d = decide(base, rules, facts(f));
      expect(d.bloqueadores, JSON.stringify(f)).toEqual([]);
      expect(d.riesgos, JSON.stringify(f)).toEqual([]);
    }
    const modelo = decide(
      { ...base, bloqueadores_duros: ["Salario bajo el piso"] },
      rules,
      facts({ salaryMaxUsd: 150, salaryPeriod: "hora" }),
    );
    expect(modelo.bloqueadores).toEqual(["Salario bajo el piso"]);
  });

  it("dato estructurado ≥ piso: el bloqueador de salario del modelo se cae", () => {
    const d = decide(
      { ...base, bloqueadores_duros: ["Salario por debajo del piso"] },
      rules,
      facts({ salaryMinUsd: 3600, salaryMaxUsd: 5200, salaryPeriod: "mensual" }),
    );
    expect(d.bloqueadores).toEqual([]);
    expect(d.accion).toBe("aplicar");
  });

  it("el bloqueador de salario que también habla de otra cosa se conserva", () => {
    const d = decide(
      { ...base, bloqueadores_duros: ["Salario bajo y jornada de 48 hs"] },
      rules,
      facts({ salaryMaxUsd: 5000, salaryPeriod: "mensual" }),
    );
    expect(d.bloqueadores).toEqual(["Salario bajo y jornada de 48 hs"]);
  });

  it("el rango que arranca abajo del piso es riesgo, no bloqueador", () => {
    const d = decide(
      base,
      rules,
      facts({ salaryMinUsd: 2500, salaryMaxUsd: 3500, salaryPeriod: "mensual" }),
    );
    expect(d.bloqueadores).toEqual([]);
    expect(d.riesgos).toEqual(["el rango salarial empieza abajo de tu piso"]);
  });

  it("nota de moneda local → riesgo, nunca bloqueador (golden 29)", () => {
    const d = decide(
      base,
      rules,
      facts({ salaryMaxUsd: 7000, salaryPeriod: "mensual", salaryNote: "pagado en ARS" }),
    );
    expect(d.bloqueadores).toEqual([]);
    expect(d.riesgos).toEqual(["salario en USD pagado en moneda local"]);
  });

  it("sin piso configurado la regla de piso está apagada", () => {
    const d = decide(
      base,
      { ...rules, salary_floor_usd_monthly: null },
      facts({ salaryMaxUsd: 100, salaryPeriod: "mensual" }),
    );
    expect(d.bloqueadores).toEqual([]);
  });

  it("sin jobFacts todo queda como antes", () => {
    expect(decide(base, rules, {})).toEqual(decide(base, rules));
  });

  describe("salario leído del texto del aviso (S-O4, ronda 109)", () => {
    const delTexto = (f: object) => facts({ ...f, salaryFromApi: false });
    const delApi = (f: object) => facts({ ...f, salaryFromApi: true });

    it("bajo el piso: de la API bloquea; del texto no bloquea", () => {
      const f = { salaryMinUsd: 2400, salaryMaxUsd: 2800, salaryPeriod: "mensual" };
      expect(decide(base, rules, delApi(f)).bloqueadores).toHaveLength(1);
      const t = decide(base, rules, delTexto(f));
      expect(t.bloqueadores).toEqual([]);
      expect(t.riesgos).toEqual([]);
      expect(t.accion).toBe("aplicar");
    });

    it("≥ piso: de la API hace caer el bloqueador del modelo; del texto no", () => {
      const ev = { ...base, bloqueadores_duros: ["Salario por debajo del piso"] };
      const f = { salaryMinUsd: 3600, salaryMaxUsd: 5200, salaryPeriod: "mensual" };
      expect(decide(ev, rules, delApi(f)).bloqueadores).toEqual([]);
      const t = decide(ev, rules, delTexto(f));
      expect(t.bloqueadores).toEqual(["Salario por debajo del piso"]);
      expect(t.accion).toBe("descartar");
    });

    it("del texto tampoco agrega el riesgo de rango; la moneda local sigue siendo riesgo", () => {
      const rango = { salaryMinUsd: 2500, salaryMaxUsd: 3500, salaryPeriod: "mensual" };
      expect(decide(base, rules, delTexto(rango)).riesgos).toEqual([]);
      const local = { salaryMaxUsd: 7000, salaryPeriod: "mensual", salaryNote: "pagado en ARS" };
      expect(decide(base, rules, delTexto(local)).riesgos).toEqual([
        "salario en USD pagado en moneda local",
      ]);
    });
  });
});

describe("decide(): riesgos informativos no bajan «aplicar personalizado» (R-O4, ronda 109)", () => {
  const alto: Evaluation = { ...base, score: 9.5, years_required: null };
  const facts = (f: NonNullable<Parameters<typeof decide>[2]>["jobFacts"]) => ({ jobFacts: f });

  it("solo un riesgo de seniority del título: sigue en aplicar_personalizado y se muestra", () => {
    const d = decide(alto, rules, {
      candidateYearsTotal: 5,
      jobFacts: { title: "Desarrollador Fullstack Junior" },
    });
    expect(d.riesgos).toHaveLength(1);
    expect(d.riesgosInformativos).toEqual(d.riesgos);
    expect(d.accion).toBe("aplicar_personalizado");
  });

  it("rango que arranca bajo el piso y moneda local también son informativos", () => {
    const d = decide(
      alto,
      rules,
      facts({
        salaryMinUsd: 2500,
        salaryMaxUsd: 7000,
        salaryPeriod: "mensual",
        salaryNote: "pagado en ARS",
        salaryFromApi: true,
      }),
    );
    expect(d.riesgos).toEqual([
      "el rango salarial empieza abajo de tu piso",
      "salario en USD pagado en moneda local",
    ]);
    expect(d.riesgosInformativos).toEqual(d.riesgos);
    expect(d.accion).toBe("aplicar_personalizado");
  });

  it("con un riesgo del modelo baja a aplicar, aunque haya informativos", () => {
    const d = decide({ ...alto, riesgos: ["Equipo muy chico"] }, rules, {
      candidateYearsTotal: 5,
      jobFacts: { title: "Desarrollador Fullstack Junior" },
    });
    expect(d.riesgos).toHaveLength(2);
    expect(d.riesgosInformativos).toHaveLength(1);
    expect(d.riesgosInformativos).not.toContain("Equipo muy chico");
    expect(d.accion).toBe("aplicar");
  });

  it("sin jobFacts no hay informativos y todo sigue igual", () => {
    const d = decide({ ...alto, riesgos: ["Equipo muy chico"] }, rules);
    expect(d.riesgosInformativos).toEqual([]);
    expect(d.accion).toBe("aplicar");
    expect(decide(alto, rules).accion).toBe("aplicar_personalizado");
  });
});

describe("decide(): jobFacts, jornada y seniority del título", () => {
  const sinAnos: Evaluation = { ...base, years_required: null };
  it("horas semanales sobre el máximo → bloqueador; en el máximo no", () => {
    const d = decide(base, rules, { jobFacts: { weeklyHours: 48 } });
    expect(d.bloqueadores).toEqual(["jornada de 48 h (máximo 40)"]);
    expect(decide(base, rules, { jobFacts: { weeklyHours: 40 } }).bloqueadores).toEqual([]);
    expect(decide(base, rules, { jobFacts: { weeklyHours: null } }).bloqueadores).toEqual([]);
  });

  it("no duplica el bloqueador de jornada del modelo", () => {
    const d = decide({ ...base, bloqueadores_duros: ["Jornada de 48 hs"] }, rules, {
      jobFacts: { weeklyHours: 48 },
    });
    expect(d.bloqueadores).toEqual(["Jornada de 48 hs"]);
  });

  it("título junior con ~5 años → riesgo (golden 2), no bloqueador ni score", () => {
    const d = decide(base, rules, {
      candidateYearsTotal: 5,
      jobFacts: { title: "Desarrollador Fullstack Junior" },
    });
    expect(d.bloqueadores).toEqual([]);
    expect(d.scoreFinal).toBe(8);
    expect(d.riesgos).toEqual([
      "el aviso es junior y tenés ~5 años: pueden descartarte por sobrecalificado o pagar menos",
    ]);
  });

  it("título senior con pocos años → riesgo; Lead lo trata el prefiltro", () => {
    const d = decide(sinAnos, rules, {
      candidateYearsTotal: 2,
      jobFacts: { title: "Senior Backend Engineer" },
    });
    expect(d.riesgos).toEqual(["el aviso es senior y tenés ~2 años"]);
    const lead = decide(sinAnos, rules, {
      candidateYearsTotal: 2,
      jobFacts: { title: "Tech Lead" },
    });
    expect(lead.riesgos).toEqual([]);
  });

  it("sin años, sin título con nivel o con años acordes: sin riesgo (golden 33: 'Expert')", () => {
    const t = (title: string, years: number | null) =>
      decide(sinAnos, rules, { candidateYearsTotal: years, jobFacts: { title } }).riesgos;
    expect(t("Agentic AI Expert (Remote)", 5)).toEqual([]);
    expect(t("Junior Developer", null)).toEqual([]);
    expect(t("Junior Developer", 2)).toEqual([]);
    expect(t("Senior Developer", 6)).toEqual([]);
  });
});

describe("decide(): inglés en un aviso en español que no lo pide (ronda 101)", () => {
  const jdEs =
    "Buscamos una persona desarrolladora para sumarse a nuestro equipo de producto. Vas a trabajar con Python y APIs, de manera remota, con un horario flexible. Ofrecemos capacitación continua y un buen clima laboral.";
  const jdEn =
    "We are looking for a developer to join our product team. You will work with Python and APIs. Excellent written English is required for daily communication with our US team.";
  const avanzado: Evaluation = {
    ...base,
    ingles_requerido: "avanzado",
    riesgos: ["Inglés avanzado requerido"],
  };

  it("aviso en español sin pedir inglés: sin penalización ni riesgo de inglés", () => {
    const d = decide(avanzado, rules, {
      candidateEnglishCefr: "B2",
      jobFacts: { jdText: jdEs },
    });
    expect(d.scoreFinal).toBe(8);
    expect(d.riesgos).toEqual([]);
    expect(d.adjustments).toEqual([]);
    expect(d.accion).toBe("aplicar");
  });

  it("un bloqueador de inglés del modelo no se borra: pasa a riesgo (S-O3); el mixto se queda", () => {
    const d = decide(
      { ...base, bloqueadores_duros: ["Inglés avanzado excluyente", "Jornada de 48 hs e inglés"] },
      rules,
      { jobFacts: { jdText: jdEs } },
    );
    expect(d.bloqueadores).toEqual(["Jornada de 48 hs e inglés"]);
    expect(d.riesgos).toEqual(["el modelo marcó inglés, pero el aviso parece no pedirlo"]);
  });

  it("solo con el bloqueador de inglés: desaparece, aparece el riesgo y la acción baja a aplicar", () => {
    const d = decide({ ...base, bloqueadores_duros: ["Inglés avanzado excluyente"] }, rules, {
      jobFacts: { jdText: jdEs },
    });
    expect(d.bloqueadores).toEqual([]);
    expect(d.riesgos).toEqual(["el modelo marcó inglés, pero el aviso parece no pedirlo"]);
    expect(d.accion).toBe("aplicar");
    expect(d.scoreFinal).toBe(8);
    expect(d.adjustments).toEqual([]);
  });

  it("dos bloqueadores de inglés dejan un solo riesgo; los riesgos de inglés del modelo se siguen sacando", () => {
    const d = decide(
      {
        ...base,
        ingles_requerido: "avanzado",
        bloqueadores_duros: ["Inglés avanzado excluyente", "English fluency required"],
        riesgos: ["Inglés avanzado requerido"],
      },
      rules,
      { jobFacts: { jdText: jdEs } },
    );
    expect(d.bloqueadores).toEqual([]);
    expect(d.riesgos).toEqual(["el modelo marcó inglés, pero el aviso parece no pedirlo"]);
  });

  it("aviso en inglés, o sin jdText: todo igual que hoy", () => {
    const en = decide(avanzado, rules, { candidateEnglishCefr: "B2", jobFacts: { jdText: jdEn } });
    const sin = decide(avanzado, rules, { candidateEnglishCefr: "B2" });
    expect(en.scoreFinal).toBe(7);
    expect(en).toEqual(sin);
    expect(sin.riesgos.length).toBeGreaterThan(0);
  });
});
