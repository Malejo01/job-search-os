import { err, ok, type Result } from "./result";

/**
 * Costo de IA por unidad (tablero de costos): oferta evaluada, simulación de Interview, charla del coach,
 * diagnóstico del CV y persona activa. Puro: la web lee filas agregadas de `llm_calls` y acá se validan y
 * se dividen. Sin ids ni emails: el gasto por persona entra como una lista de números anónima.
 *
 * Qué tareas de `llm_calls` cuenta cada unidad (cada tarea está en una sola, sin doble conteo):
 * - oferta evaluada: `evaluate_job` + `extract_skills`; unidades = `evaluate_job` logradas;
 * - simulación de Interview: `interview_questions` + `interview_feedback`; unidades = `interview_questions`
 *   logradas (una por simulación, el feedback es una llamada por respuesta);
 * - charla del coach: `cv_coach_turn` + `cv_interview` + `cv_write`; unidades = `label` distintos
 *   (`cv:<flowId>`) de esas tareas, que cuenta la consulta;
 * - diagnóstico del CV: `cv_review`; unidades = llamadas logradas.
 * Lo demás (asistente, parseo de emails, lectura del CV, etc.) entra solo en el gasto por persona.
 */
export const OFFER_UNIT_TASKS = ["evaluate_job", "extract_skills"] as const;
export const INTERVIEW_UNIT_TASKS = ["interview_questions", "interview_feedback"] as const;
export const COACH_UNIT_TASKS = ["cv_coach_turn", "cv_interview", "cv_write"] as const;
export const CV_DIAGNOSIS_UNIT_TASKS = ["cv_review"] as const;

/** Tarea que cuenta las unidades de cada tipo (llamadas logradas). */
export const OFFER_COUNT_TASK = "evaluate_job";
export const INTERVIEW_COUNT_TASK = "interview_questions";
export const CV_DIAGNOSIS_COUNT_TASK = "cv_review";

/** Con menos personas que esto no se muestra p50 ni p90: «menos de 3». */
export const MIN_PEOPLE_FOR_PERCENTILES = 3;

/** Una fila agregada: gasto y llamadas de una tarea en la ventana. */
export type UnitCostTaskRow = {
  task: string;
  spendUsd: number;
  calls: number;
  okCalls: number;
};

export type UnitCostInput = {
  tasks: UnitCostTaskRow[];
  /** Charlas del coach distintas (labels distintos de las tareas del coach). */
  coachChats: number;
  /** Gasto total de IA de cada persona con gasto en la ventana; anónimo, sin ids. */
  personSpendUsd: number[];
};

export type UnitCost = {
  units: number;
  spendUsd: number;
  /** null = sin datos (cero unidades): nunca una división por cero. */
  costPerUnitUsd: number | null;
};

export type PersonCost =
  | { kind: "sin_datos" }
  | { kind: "menos_de_3"; people: number }
  | { kind: "ok"; people: number; p50Usd: number; p90Usd: number };

export type UnitCostReport = {
  offer: UnitCost;
  interview: UnitCost;
  coach: UnitCost;
  cvDiagnosis: UnitCost;
  person: PersonCost;
};

/** Percentil por interpolación lineal (0 a 1); lista vacía = null. No modifica la entrada. */
export function unitPercentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(Math.max(p, 0), 1) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const loV = sorted[lo] as number;
  if (lo === hi) return loV;
  const hiV = sorted[hi] as number;
  return loV + (hiV - loV) * (idx - lo);
}

const validAmount = (n: number) => Number.isFinite(n) && n >= 0;
const validCount = (n: number) => Number.isInteger(n) && n >= 0;

function unitCost(units: number, spendUsd: number): UnitCost {
  return { units, spendUsd, costPerUnitUsd: units > 0 ? spendUsd / units : null };
}

export function computeUnitCosts(input: UnitCostInput): Result<UnitCostReport, string> {
  if (!validCount(input.coachChats)) return err("coachChats inválido");
  for (const t of input.tasks) {
    if (!validAmount(t.spendUsd)) return err("gasto de tarea inválido");
    if (!validCount(t.calls) || !validCount(t.okCalls) || t.okCalls > t.calls) {
      return err("llamadas de tarea inválidas");
    }
  }
  for (const v of input.personSpendUsd) {
    if (!validAmount(v)) return err("gasto por persona inválido");
  }

  const spend = (names: readonly string[]) =>
    input.tasks.filter((t) => names.includes(t.task)).reduce((a, t) => a + t.spendUsd, 0);
  const okCalls = (name: string) =>
    input.tasks.filter((t) => t.task === name).reduce((a, t) => a + t.okCalls, 0);

  const people = input.personSpendUsd.length;
  let person: PersonCost;
  if (people === 0) person = { kind: "sin_datos" };
  else if (people < MIN_PEOPLE_FOR_PERCENTILES) person = { kind: "menos_de_3", people };
  else {
    person = {
      kind: "ok",
      people,
      p50Usd: unitPercentile(input.personSpendUsd, 0.5) as number,
      p90Usd: unitPercentile(input.personSpendUsd, 0.9) as number,
    };
  }

  return ok({
    offer: unitCost(okCalls(OFFER_COUNT_TASK), spend(OFFER_UNIT_TASKS)),
    interview: unitCost(okCalls(INTERVIEW_COUNT_TASK), spend(INTERVIEW_UNIT_TASKS)),
    coach: unitCost(input.coachChats, spend(COACH_UNIT_TASKS)),
    cvDiagnosis: unitCost(okCalls(CV_DIAGNOSIS_COUNT_TASK), spend(CV_DIAGNOSIS_UNIT_TASKS)),
    person,
  });
}
