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
