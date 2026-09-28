import { foldText } from "../normalize/text";

/**
 * Qué sueldo pedir en un formulario (JS-053). Es una respuesta fija: la calcula el código y el
 * modelo la copia textual. Regla: con rango publicado, max(mínimo, piso); sin rango, el piso.
 * Todo lo que no se puede llevar con certeza a USD mensuales devuelve una marca, nunca un número.
 * Orden: part_time → no_normalizable → (piso_inconsistente) → bajo_piso → pedir.
 */
export type SalaryJob = {
  title: string;
  salaryMinUsd: number | null;
  salaryMaxUsd: number | null;
  salaryPeriod: string | null; // mensual | anual | hora
  salaryNote: string | null;
  weeklyHours: number | null;
};

/** Piso del perfil (profiles.salary_floor_usd) y de los criterios activos (salary_floor_usd_monthly). */
export type SalaryFloors = { profileFloorUsd: number | null; criteriaFloorUsd: number | null };

export type SalaryAsk =
  | { kind: "pedir"; usdMonthly: number; basis: "minimo_del_rango" | "piso" | "piso_sin_rango" }
  | { kind: "part_time"; reason: string }
  | { kind: "no_normalizable"; reason: string }
  | { kind: "bajo_piso"; floorUsd: number; maxUsd: number }
  | { kind: "piso_inconsistente"; profileFloorUsd: number | null; criteriaFloorUsd: number | null };

export const PART_TIME_MAX_HOURS = 30;

const PART_TIME_TITLE = /\bpart[- ]time\b|\bfractional\b|\bmedio tiempo\b|\bmedia jornada\b/;

export function isPartTimeTitle(title: string): boolean {
  return PART_TIME_TITLE.test(foldText(title));
}

// Monedas que no son USD, como aparecen en notas de sueldo ("pagado en ARS", "€45k", "R$ 8.000")
const OTHER_CURRENCY = /\b(ars|pesos?|eur|euros?|brl|reales|mxn|clp|cop|uyu|gbp)\b|€|£|r\$/;

function notNormalizable(job: SalaryJob): string | null {
  const note = job.salaryNote ? foldText(job.salaryNote) : null;
  if (note && OTHER_CURRENCY.test(note)) return `moneda distinta de USD: "${job.salaryNote}"`;
  const hasAmounts = job.salaryMinUsd !== null || job.salaryMaxUsd !== null;
  if (hasAmounts && job.salaryPeriod !== "mensual") {
    return job.salaryPeriod
      ? `sueldo publicado por ${job.salaryPeriod}`
      : "montos sin período publicado";
  }
  if (!hasAmounts && note && /\d/.test(note)) {
    return `sueldo sin moneda normalizada: "${job.salaryNote}"`;
  }
  return null;
}

export function salaryAsk(job: SalaryJob, floors: SalaryFloors): SalaryAsk {
  if (job.weeklyHours !== null && job.weeklyHours < PART_TIME_MAX_HOURS) {
    return {
      kind: "part_time",
      reason: `${job.weeklyHours} h semanales (< ${PART_TIME_MAX_HOURS})`,
    };
  }
  if (isPartTimeTitle(job.title)) return { kind: "part_time", reason: `título: "${job.title}"` };

  const reason = notNormalizable(job);
  if (reason) return { kind: "no_normalizable", reason };

  const { profileFloorUsd, criteriaFloorUsd } = floors;
  if (
    profileFloorUsd === null ||
    criteriaFloorUsd === null ||
    profileFloorUsd !== criteriaFloorUsd
  ) {
    return { kind: "piso_inconsistente", profileFloorUsd, criteriaFloorUsd };
  }
  const floor = profileFloorUsd;

  if (job.salaryMaxUsd !== null && job.salaryMaxUsd < floor) {
    return { kind: "bajo_piso", floorUsd: floor, maxUsd: job.salaryMaxUsd };
  }
  if (job.salaryMinUsd === null) {
    return {
      kind: "pedir",
      usdMonthly: floor,
      basis: job.salaryMaxUsd === null ? "piso_sin_rango" : "piso",
    };
  }
  return job.salaryMinUsd >= floor
    ? { kind: "pedir", usdMonthly: job.salaryMinUsd, basis: "minimo_del_rango" }
    : { kind: "pedir", usdMonthly: floor, basis: "piso" };
}
