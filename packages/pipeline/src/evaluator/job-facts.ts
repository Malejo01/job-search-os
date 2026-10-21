import { foldText } from "../normalize/text";

/**
 * Hechos estructurados del aviso (`jobs.*`) que `decide()` y `buildChecklist()` comparten. El código
 * decide con esto antes que con el texto libre del modelo. Todo opcional: sin dato no se infiere nada.
 */
export type JobFacts = {
  title?: string | null;
  salaryMinUsd?: number | null;
  salaryMaxUsd?: number | null;
  /** `jobs.salary_period`: mensual | anual | hora. */
  salaryPeriod?: string | null;
  salaryNote?: string | null;
  weeklyHours?: number | null;
  /** Texto del aviso: solo para detectar el idioma (inglés en un aviso en español). */
  jdText?: string | null;
};

export type MonthlySalary = { min: number | null; max: number | null };

const MONTHLY = new Set(["mensual", "monthly", "month", "mes"]);
const ANNUAL = new Set(["anual", "annual", "yearly", "year", "ano"]);

const positive = (n: number | null | undefined): number | null =>
  typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null;

/**
 * Salario en USD por mes. `mensual` queda igual, `anual` se divide por 12. Por hora, otro período o
 * sin período es `null` (no comparable con un piso mensual: se trata como "no se sabe"), igual que
 * un aviso sin cifras.
 */
export function monthlySalaryUsd(facts: JobFacts | undefined): MonthlySalary | null {
  if (!facts) return null;
  const min = positive(facts.salaryMinUsd);
  const max = positive(facts.salaryMaxUsd);
  if (min === null && max === null) return null;
  const period = foldText(facts.salaryPeriod ?? "").trim();
  const k = MONTHLY.has(period) ? 1 : ANNUAL.has(period) ? 1 / 12 : null;
  if (k === null) return null;
  const round = (n: number | null) => (n === null ? null : Math.round(n * k));
  return { min: round(min), max: round(max) };
}

/**
 * El aviso dice que el salario en USD se paga en moneda local (golden 29). Por sí sola es riesgo, no
 * bloqueador; pero si el máximo en USD ya está bajo el piso, `decide()` bloquea igual.
 */
export const LOCAL_CURRENCY_NOTE = /\b(?:ars|pesos?|moneda local)\b/i;

export const salaryIsLocalCurrency = (facts: JobFacts | undefined): boolean =>
  Boolean(facts?.salaryNote && LOCAL_CURRENCY_NOTE.test(facts.salaryNote));

/** Un bloqueador o riesgo de salario escrito por el modelo (o por el código). */
export const IS_SALARY_TEXT = /salari|sueldo|remuneraci|usd|piso/i;
/** Habla también de otra cosa: no se toca (lo conservador, como el de modalidad en decide()). */
export const MIXED_TOPIC_TEXT =
  /jornada|horas|\bhs\b|a[ñn]os|years|visa|autoriz|residen|residir|presencial|h[ií]brid|oficina|disciplina|ingl[eé]s|english|contrat|freelance|relocat/i;
