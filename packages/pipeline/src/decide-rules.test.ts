import { describe, expect, it } from "vitest";
import type { CriteriaRules } from "./criteria";
import { decide } from "./decide";
import { checkDecideRules, decideChecked } from "./decide-rules";
import type { Evaluation } from "./evaluation";

/**
 * R34-07 (decisión del 27/11): decide() con reglas vacías o incompletas falla cerrado. Devuelve un Result con
 * error, no inventa reglas ni usa valores por defecto, y nunca lanza (antes, `rules = {}` tiraba un TypeError al
 * leer `years_penalty` o `thresholds`). Quien llama deja la oferta «Sin evaluar». Datos inventados.
 */
const RULES: CriteriaRules = {
  title_blocklist: [],
  title_allowlist: [],
  title_cap_score: 6,
  title_cap_score_if_few_candidates: { max_candidates: 20, cap: 7, disciplines: [] },
  max_years_hard: 8,
  years_penalty: { from: 5, to: 7, penalty: 1 },
  years_gap: { risk_from: 1, penalty_from: null, penalty: 0, blocker_from: null },
  ml_engineer_keywords: [],
  ai_eval_keywords: [],
  other_discipline_keywords: [],
  allowed_disciplines: ["qa"],
  discipline_cap_score: 4,
  english_risk_from: "avanzado",
  cloud_must_penalty: 1,
  english_fluent_penalty: 1,
  easy_apply_penalty: 0,
  skills_match_badge: { analyze_from: 6, discard_below: 3 },
  salary_floor_usd_monthly: null,
  max_weekly_hours: 45,
  thresholds: { personalizado: 9, aplicar: 7, guardar: 5 },
};

const EVALUATION = {
  score: 8,
  bloqueadores_duros: [],
  riesgos: [],
  years_required: 3,
  years_domain: null,
  years_discipline: null,
  disciplina: "qa",
  modalidad: "remoto",
  ingles_requerido: "intermedio",
  location_ok: "ok",
  gaps: [],
  match_fuerte: [],
  senales_positivas: [],
  tipo_empresa: "producto",
  veredicto: "Encaja.",
} as unknown as Evaluation;

describe("checkDecideRules", () => {
  it("acepta las reglas completas tal cual, sin cambiarlas", () => {
    const r = checkDecideRules(RULES);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(RULES);
  });

  it.each([
    ["objeto vacío", {}],
    ["null", null],
    ["undefined", undefined],
    ["un array", []],
    ["un texto", "{}"],
  ])("reglas vacías (%s): error reglas_vacias", (_, rules) => {
    const r = checkDecideRules(rules);
    expect(r).toEqual({ ok: false, error: { code: "reglas_vacias", missing: [] } });
  });

  it("reglas incompletas: dice qué falta, sin rellenarlo", () => {
    const { thresholds: _t, years_penalty: _y, ...rest } = RULES;
    const r = checkDecideRules(rest);
    expect(r).toEqual({
      ok: false,
      error: { code: "reglas_incompletas", missing: ["years_penalty", "thresholds"] },
    });
  });

  it.each([
    [
      "umbral que no es número",
      { ...RULES, thresholds: { ...RULES.thresholds, aplicar: "7" } },
      "thresholds",
    ],
    [
      "umbral NaN",
      { ...RULES, thresholds: { ...RULES.thresholds, guardar: Number.NaN } },
      "thresholds",
    ],
    ["años duros nulos", { ...RULES, max_years_hard: null }, "max_years_hard"],
    [
      "penalización sin `to`",
      { ...RULES, years_penalty: { from: 5, penalty: 1 } },
      "years_penalty",
    ],
  ])("%s: reglas_incompletas", (_, rules, field) => {
    const r = checkDecideRules(rules);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("reglas_incompletas");
      expect(r.error.missing).toEqual([field]);
    }
  });
});

describe("decideChecked", () => {
  it("con reglas válidas da lo mismo que decide()", () => {
    const r = decideChecked(EVALUATION, RULES);
    expect(r).toEqual({ ok: true, value: decide(EVALUATION, RULES) });
  });

  it("con reglas vacías falla cerrado y no lanza", () => {
    expect(() => decideChecked(EVALUATION, {})).not.toThrow();
    const r = decideChecked(EVALUATION, {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("reglas_vacias");
  });

  it("no inventa una acción: sin reglas no hay decisión", () => {
    const r = decideChecked({ ...EVALUATION, score: 10 }, { thresholds: RULES.thresholds });
    expect(r.ok).toBe(false);
    expect("value" in r).toBe(false);
  });
});
