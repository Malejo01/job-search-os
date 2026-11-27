import type { CriteriaRules } from "./criteria";
import { decide, type DecideContext, type Decision } from "./decide";
import type { Evaluation } from "./evaluation";
import { err, ok, type Result } from "./result";

/**
 * R34-07 (decisión del 27/11): decide() con reglas vacías o incompletas falla cerrado. Las reglas vienen de
 * `evaluation_criteria.rules` (jsonb editable sin migración): si llegan vacías (`{}`) o sin lo que decide() lee
 * siempre, no se decide nada. No se inventan reglas ni se usan valores por defecto: se devuelve un error y quien
 * llama deja la oferta «Sin evaluar» y lo anota en el log con `user_id` y `job_id`.
 *
 * Se exige solo lo que decide() lee sin condición (los umbrales, los años duros y la penalización por años). Lo
 * demás es opcional en decide(): si falta, esa regla queda apagada, como hasta ahora.
 */
export type DecideRulesError = {
  code: "reglas_vacias" | "reglas_incompletas";
  /** Campos que faltan o no tienen la forma esperada. Vacío cuando no hay reglas. */
  missing: string[];
};

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const hasNums = (v: unknown, keys: readonly string[]): boolean =>
  isObj(v) && keys.every((k) => isNum(v[k]));

const REQUIRED: readonly { field: keyof CriteriaRules; valid: (v: unknown) => boolean }[] = [
  { field: "max_years_hard", valid: isNum },
  { field: "years_penalty", valid: (v) => hasNums(v, ["from", "to", "penalty"]) },
  { field: "thresholds", valid: (v) => hasNums(v, ["personalizado", "aplicar", "guardar"]) },
];

export function checkDecideRules(rules: unknown): Result<CriteriaRules, DecideRulesError> {
  if (!isObj(rules) || Object.keys(rules).length === 0) {
    return err({ code: "reglas_vacias", missing: [] });
  }
  const missing = REQUIRED.filter((r) => !r.valid(rules[r.field])).map((r) => r.field);
  if (missing.length > 0) return err({ code: "reglas_incompletas", missing });
  return ok(rules as CriteriaRules);
}

/** decide() detrás de la verificación de reglas: con reglas vacías o incompletas, error y ninguna decisión. */
export function decideChecked(
  evaluation: Evaluation,
  rules: unknown,
  context: DecideContext = {},
): Result<Decision, DecideRulesError> {
  const checked = checkDecideRules(rules);
  if (!checked.ok) return checked;
  return ok(decide(evaluation, checked.value, context));
}
