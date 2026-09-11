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
  ml_engineer_keywords: string[];
  ai_eval_keywords: string[];
  other_discipline_keywords: string[];
  cloud_must_penalty: number;
  english_fluent_penalty: number;
  easy_apply_penalty: number;
  skills_match_badge: { analyze_from: number; discard_below: number };
  salary_floor_usd_monthly: number;
  max_weekly_hours: number;
  thresholds: { personalizado: number; aplicar: number; guardar: number };
};
