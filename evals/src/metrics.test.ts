import { describe, expect, it } from "vitest";
import {
  anchorFor,
  classifyBlocker,
  classifyRisk,
  typedMatch,
  checkThresholds,
  computeMetrics,
  isUnstable,
  median,
  promptVersionNumber,
  sameAction,
  splitByAnchorSource,
  type JobRow,
} from "./metrics";

const row = (over: Partial<JobRow>): JobRow => ({
  id: 1,
  human_score: 7,
  human_score_match: 7,
  human_blockers: [],
  human_blockers_legacy: [],
  human_risks: [],
  human_discipline: "ai_engineer",
  human_action: "aplicar",
  human_location_ok: "ok",
  human_location_ok_clean: "ok",
  model_score: 7,
  scores: [7, 7, 7],
  model_blockers: [],
  model_risks: [],
  model_discipline: "ai_engineer",
  model_action: "aplicar",
  model_location_ok: "ok",
  unstable: false,
  ...over,
});

describe("median / isUnstable / versión", () => {
  it("mediana de 3 y de 2 corridas", () => {
    expect(median([8, 6, 7])).toBe(7);
    expect(median([6, 8])).toBe(7);
    expect(median([])).toBeNull();
  });
  it("inestable si el rango supera 1.5", () => {
    expect(isUnstable([6, 7.5])).toBe(false);
    expect(isUnstable([6, 8])).toBe(true);
    expect(isUnstable([6])).toBe(false);
  });
  it("ancla por versión de prompt: v1 → human_score, v1.1+ → human_score_match", () => {
    expect(promptVersionNumber("evaluate_job@v1")).toBe(1);
    expect(promptVersionNumber("evaluate_job@v1.1")).toBe(1.1);
    expect(anchorFor("evaluate_job@v1")).toBe("human_score");
    expect(anchorFor("evaluate_job@v1.1")).toBe("human_score_match");
    expect(anchorFor("evaluate_job@v2")).toBe("human_score_match");
  });
});

describe("computeMetrics", () => {
  it("MAE contra el ancla, y siempre contra las dos referencias", () => {
    const rows = [
      row({ id: 1, human_score: 6, human_score_match: 8, model_score: 8 }),
      row({ id: 2, human_score: 4, human_score_match: 4, model_score: 5 }),
    ];
    const v1 = computeMetrics(rows, "human_score");
    expect(v1.score_mae).toBe(1.5);
    expect(v1.score_mae_legacy).toBe(1.5);
    expect(v1.score_mae_match).toBe(0.5);
    const v11 = computeMetrics(rows, "human_score_match");
    expect(v11.score_mae).toBe(0.5);
    expect(v11.risks_recall).toBeNull(); // sin filas con riesgo humano → n/a
  });

  it("personalizado cuenta como aplicar; MAE ignora jobs sin ancla", () => {
    const m = computeMetrics([
      row({ id: 1, human_score: 8, model_score: 9, model_action: "aplicar_personalizado" }),
      row({
        id: 2,
        human_score: null,
        human_score_match: null,
        model_score: 3,
        model_action: "descartar",
        human_action: "descartar",
      }),
    ]);
    expect(m.n_scored).toBe(1);
    expect(m.score_mae).toBe(1);
    expect(m.action_acc).toBe(1);
    expect(sameAction("aplicar_personalizado", "aplicar")).toBe(true);
  });

  it("bloqueadores: recall contra el ancla (legacy en v1, v1.1 en el resto) y precisión", () => {
    const rows = [
      // v1.1 lo considera riesgo, Mauro lo anotó como bloqueador
      row({
        id: 32,
        human_blockers_legacy: ["Argentina fuera de países"],
        human_blockers: [],
        human_risks: ["país no listado"],
        model_blockers: ["país no permitido"],
      }),
      row({
        id: 2,
        human_blockers_legacy: ["presencial"],
        human_blockers: ["modalidad presencial"],
        model_blockers: ["presencial"],
      }),
      row({ id: 9, human_blockers_legacy: ["stack core ajeno"], human_blockers: [] }),
    ];
    const v1 = computeMetrics(rows, "human_score");
    expect(v1.blockers_recall).toBeCloseTo(2 / 3);
    expect(v1.blockers_precision).toBe(1);
    const v11 = computeMetrics(rows, "human_score_match");
    expect(v11.blockers_recall).toBe(1); // solo el 2 tiene bloqueador v1.1 y el modelo lo dio
    expect(v11.blockers_precision).toBe(0.5); // en el 32 el modelo bloqueó un riesgo
  });

  it("risks_recall solo en v1.1+", () => {
    const rows = [
      row({ id: 34, human_risks: ["LATAM sin países"], model_risks: ["LATAM"] }),
      row({ id: 16, human_risks: ["LATAM sin países"], model_risks: [] }),
      row({ id: 33 }),
    ];
    expect(computeMetrics(rows, "human_score_match").risks_recall).toBe(0.5);
    expect(computeMetrics(rows, "human_score").risks_recall).toBeNull();
  });

  it("recall de riesgo de ubicación y false_apply contra el ancla", () => {
    const m = computeMetrics(
      [
        row({ id: 3, human_location_ok_clean: "riesgo", model_location_ok: "no" }),
        row({ id: 4, human_location_ok_clean: "riesgo", model_location_ok: "ok" }),
        // con ancla match, el location_ok viejo (mezclaba modalidad) no cuenta
        row({
          id: 6,
          human_location_ok: "riesgo",
          human_location_ok_clean: "ok",
          model_location_ok: "ok",
        }),
        row({
          id: 5,
          human_score: 3,
          human_score_match: 5,
          model_score: 8,
          model_action: "aplicar",
        }),
      ],
      "human_score_match",
    );
    // Exacto: "riesgo" humano vs "no" del modelo ya no cuenta (son decisiones distintas); la vieja sí
    expect(m.location_risk_recall).toBe(0);
    expect(m.location_risk_recall_any).toBe(0.5);
    expect(m.false_apply).toBe(0); // con ancla match (5) no cuenta; con legacy (3) sí
    const legacy = computeMetrics([
      row({ id: 5, human_score: 3, model_score: 8, model_action: "aplicar" }),
    ]);
    expect(legacy.false_apply).toBe(1);
  });

  it("checkThresholds agrega risks_recall solo con ancla match", () => {
    const names = (a: "human_score" | "human_score_match") =>
      checkThresholds(computeMetrics([row({})], a)).map((c) => c.name);
    expect(names("human_score")).not.toContain("risks_recall = 100%");
    expect(names("human_score_match")).toContain("risks_recall = 100%");
    expect(names("human_score")).toContain("blockers_precision = 100%");
  });
});

describe("bloqueadores y riesgos por tipo (harness endurecido 2026-09-11)", () => {
  it("clasifica bloqueadores en la taxonomía cerrada; lo que no entra es 'otro'", () => {
    expect(classifyBlocker("años requeridos ≥ 8 (8)")).toBe("anos");
    expect(classifyBlocker("8+ años de experiencia requeridos")).toBe("anos");
    expect(classifyBlocker("disciplina distinta (ai_evaluation)")).toBe("disciplina");
    expect(classifyBlocker("Modalidad híbrida (visitas a CABA)")).toBe("modalidad");
    expect(classifyBlocker("Requiere autorización de trabajo en EE.UU.")).toBe("autorizacion");
    expect(classifyBlocker("Salario publicado por debajo del piso (USD 1500)")).toBe("salario");
    expect(classifyBlocker("Jornada de 48 horas")).toBe("jornada");
    expect(classifyBlocker("Rol de liderazgo (Lead)")).toBe("otro");
    expect(classifyBlocker("Inglés avanzado requerido")).toBe("otro");
  });

  it("recall y precision por tipo: bloquear por otra cosa no cuenta", () => {
    const r = typedMatch(
      [
        { human: ["disciplina distinta (ai_evaluation)"], model: ["8+ años requeridos"] },
        { human: ["modalidad híbrida"], model: ["Modalidad presencial o híbrida", "Rol Lead"] },
      ],
      classifyBlocker,
    );
    expect(r.recall).toBe(0.5); // 1 de 2 tipos humanos (modalidad)
    expect(r.precision).toBeCloseTo(1 / 3); // 3 tipos del modelo, 1 acierta
  });

  it("riesgos: 'salario no publicado' no cuenta en el recall", () => {
    expect(classifyRisk("salario no publicado")).toBe("salario");
    expect(classifyRisk("LATAM/remoto sin países explícitos")).toBe("ubicacion");
    expect(classifyRisk("Empresa de staffing (Empresa O)")).toBe("staffing");
    expect(classifyRisk("Alta competencia con 264 candidatos")).toBe("candidatos");
    const r = typedMatch(
      [
        {
          human: ["salario no publicado", "muchos candidatos (191)"],
          model: ["Salario no informado"],
        },
      ],
      classifyRisk,
      ["salario"],
    );
    expect(r.recall).toBe(0); // el único riesgo que cuenta (candidatos) no está
    expect(r.precision).toBeNull(); // el modelo solo dijo salario, que no cuenta
  });
});

describe("false_discard (JS-052): el error que más cuesta", () => {
  // El umbral real de postulación de Mauro es 5, no 7: una oferta que el modelo deja bajo 5
  // termina en descartar y no la ve nunca. Contarlas importa más que afinar el 7.
  it("cuenta las ofertas con ancla ≥ 5 que el modelo deja bajo 5", () => {
    const m = computeMetrics(
      [
        // ancla 6.5, el modelo la deja en 4.5 → falso descarte
        row({ id: 6, human_score_match: 6.5, model_score: 4.5, model_score_final: 4.5 }),
        // ancla 7, el modelo la baja pero queda en 5 → no es falso descarte
        row({ id: 16, human_score_match: 7, model_score: 5, model_score_final: 5 }),
        // ancla 3: que quede abajo está bien
        row({ id: 11, human_score_match: 3, model_score: 2, model_score_final: 2 }),
        // ancla 7 con score alto: sin problema
        row({ id: 28, human_score_match: 7, model_score: 7.5, model_score_final: 7.5 }),
      ],
      "human_score_match",
    );
    expect(m.false_discard).toBe(1);
  });

  it("mide sobre el score final de decide(), no sobre el crudo del modelo", () => {
    // El modelo dice 7,5 pero un cap de disciplina lo deja en 4: para Mauro desapareció igual
    const m = computeMetrics(
      [row({ id: 35, human_score_match: 6, model_score: 7.5, model_score_final: 4 })],
      "human_score_match",
    );
    expect(m.false_discard).toBe(1);
  });

  it("sin score final cae al crudo del modelo (reportes viejos)", () => {
    const m = computeMetrics(
      [row({ id: 7, human_score_match: 6.5, model_score: 4, model_score_final: undefined })],
      "human_score_match",
    );
    expect(m.false_discard).toBe(1);
  });

  it("false_discard_action (informativa): ancla ≥ 5 que termina en descartar aunque el score no baje", () => {
    const m = computeMetrics(
      [
        // score 6 pero bloqueador → descartar: el score no lo dice, la acción sí
        row({
          id: 30,
          human_score_match: 7,
          model_score: 6,
          model_score_final: 6,
          model_action: "descartar",
        }),
      ],
      "human_score_match",
    );
    expect(m.false_discard).toBe(0);
    expect(m.false_discard_action).toBe(1);
  });

  it("el umbral es configurable (thresholds.guardar de CriteriaRules)", () => {
    const rows = [row({ id: 1, human_score_match: 7, model_score: 5.5, model_score_final: 5.5 })];
    expect(computeMetrics(rows, "human_score_match").false_discard).toBe(0);
    expect(computeMetrics(rows, "human_score_match", 6).false_discard).toBe(1);
  });

  it("checkThresholds exige false_discard = 0", () => {
    const names = checkThresholds(computeMetrics([row({})], "human_score_match")).map(
      (c) => c.name,
    );
    expect(names).toContain("false_discard = 0");
  });
});

describe("anchor_source (JS-052): métricas separadas por origen del ancla", () => {
  it("splitByAnchorSource parte las filas en human y assisted", () => {
    const rows = [
      row({ id: 1, anchor_source: "human" }),
      row({ id: 2, anchor_source: "assisted" }),
      row({ id: 3 }), // sin campo: cuenta como human (los 26 originales)
    ];
    const s = splitByAnchorSource(rows);
    expect(s.human.map((r) => r.id)).toEqual([1, 3]);
    expect(s.assisted.map((r) => r.id)).toEqual([2]);
  });

  it("las métricas por origen se calculan sobre cada subconjunto", () => {
    const rows = [
      // human: el modelo acierta
      row({
        id: 1,
        anchor_source: "human",
        human_score_match: 7,
        model_score: 7,
        model_score_final: 7,
      }),
      // assisted: el modelo la hunde bajo el piso
      row({
        id: 2,
        anchor_source: "assisted",
        human_score_match: 6.5,
        model_score: 3,
        model_score_final: 3,
      }),
    ];
    const s = splitByAnchorSource(rows);
    expect(computeMetrics(s.human, "human_score_match").false_discard).toBe(0);
    expect(computeMetrics(s.assisted, "human_score_match").false_discard).toBe(1);
    expect(computeMetrics(rows, "human_score_match").false_discard).toBe(1);
  });
});
