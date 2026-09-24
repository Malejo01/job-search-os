/**
 * Reglas del prefiltro y de decide(), editables sin migración (tabla evaluation_criteria.rules).
 * Espejo de packages/db/schema.ts (CriteriaRules): el pipeline no importa db.
 */
export type CriteriaRules = {
  title_blocklist: string[];
  title_allowlist: string[];
  title_cap_score: number;
  title_cap_score_if_few_candidates: { max_candidates: number; cap: number; disciplines: string[] };
  max_years_hard: number;
  years_penalty: { from: number; to: number; penalty: number };
  /**
   * Gap entre los años que pide el aviso y los del candidato (JS-052). Por defecto solo riesgo:
   * las reglas absolutas (max_years_hard, years_penalty) son las que mueven el score.
   * `null` desactiva ese escalón.
   */
  years_gap: {
    risk_from: number | null;
    penalty_from: number | null;
    penalty: number;
    blocker_from: number | null;
  };
  ml_engineer_keywords: string[];
  ai_eval_keywords: string[];
  other_discipline_keywords: string[];
  /** Disciplinas del perfil. Una disciplina fuera de esta lista es bloqueador (JS-052). */
  allowed_disciplines: string[];
  /** Tope del score cuando la disciplina no es la del perfil. */
  discipline_cap_score: number;
  /** Nivel de inglés exigido desde el que se reporta riesgo si el candidato está por debajo. */
  english_risk_from: "basico" | "intermedio" | "avanzado" | "nativo";
  cloud_must_penalty: number;
  english_fluent_penalty: number;
  easy_apply_penalty: number;
  skills_match_badge: { analyze_from: number; discard_below: number };
  salary_floor_usd_monthly: number;
  max_weekly_hours: number;
  thresholds: { personalizado: number; aplicar: number; guardar: number };
};
