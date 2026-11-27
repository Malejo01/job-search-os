import { parseSalaryText, type SalaryPeriodText } from "./salary-text";

/**
 * Sueldo en la moneda original del aviso (R32-08). Hasta acá el sueldo se guardaba solo si estaba en dólares
 * (`salaryMinUsd`…); el resto quedaba como una nota de texto. Esto es lo que el aviso dice, tal cual:
 * monto mínimo y máximo, moneda y periodicidad. Puro, sin red ni fecha.
 *
 * Reglas:
 * - **La moneda tiene que estar dicha** (código de tres letras). «$» solo no la dice y no se supone: sin
 *   moneda no hay sueldo original (queda la nota de texto, como antes).
 * - Lo que el aviso no dice queda `null` (un extremo, la periodicidad); nunca se inventa.
 * - No se convierte nada: una equivalencia en dólares, si existe, es otro dato y se muestra aparte y
 *   marcada como aproximada (`formatSalaryEquivalence`).
 * - Lo que ya estaba guardado queda como está: este tipo es opcional en `RawJob`.
 */
export type SalaryOriginal = {
  min: number | null;
  max: number | null;
  /** Código de la moneda tal como lo publica el aviso, en mayúsculas: «ARS», «USD», «EUR», «BRL»… */
  currency: string;
  period: SalaryPeriodText | null;
};

/** Tope de las columnas `integer` de la base. */
const MAX_AMOUNT = 2_147_483_647;
const PERIODS: readonly SalaryPeriodText[] = ["mensual", "anual", "hora"];

function amountOf(value: unknown): number | null {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return null;
  const r = Math.round(n);
  return r >= 1 && r <= MAX_AMOUNT ? r : null;
}

/**
 * Arma un sueldo original desde las partes que dio la fuente, o `null` si falta la moneda, no hay ningún
 * monto legible o el mínimo es mayor que el máximo. Un extremo ilegible queda `null` mientras el otro sirva.
 */
export function makeSalaryOriginal(input: {
  min?: unknown;
  max?: unknown;
  currency?: unknown;
  period?: unknown;
}): SalaryOriginal | null {
  const currency = typeof input.currency === "string" ? input.currency.trim().toUpperCase() : "";
  if (!/^[A-Z]{3}$/.test(currency)) return null;
  const min = amountOf(input.min);
  const max = amountOf(input.max);
  if (min === null && max === null) return null;
  if (min !== null && max !== null && min > max) return null;
  const period = PERIODS.find((p) => p === input.period) ?? null;
  return { min, max, currency, period };
}

/**
 * El sueldo original de las cuatro columnas de la base (`jobs` y `public_jobs`), o `null` si la fila no lo
 * tiene (todo lo guardado antes de la R32 y lo que la fuente no dice). Vuelve a validar: un valor raro
 * guardado a mano no llega a la pantalla.
 */
export function salaryOriginalFromColumns(row: {
  salaryOriginalMin?: number | null;
  salaryOriginalMax?: number | null;
  salaryOriginalCurrency?: string | null;
  salaryOriginalPeriod?: string | null;
}): SalaryOriginal | null {
  return makeSalaryOriginal({
    min: row.salaryOriginalMin,
    max: row.salaryOriginalMax,
    currency: row.salaryOriginalCurrency,
    period: row.salaryOriginalPeriod,
  });
}

/**
 * El sueldo original de un texto («$ 1.200.000 a $ 1.500.000 por mes ARS»), con el lector de
 * `salary-text.ts`: si el texto es ambiguo o no dice la moneda, `null`.
 */
export function salaryOriginalFromText(text: string): SalaryOriginal | null {
  const r = parseSalaryText(text);
  if (!r.ok) return null;
  return makeSalaryOriginal(r.salary);
}

const SYMBOLS: Readonly<Record<string, string>> = {
  ARS: "$",
  MXN: "$",
  CLP: "$",
  COP: "$",
  UYU: "$",
  USD: "US$",
  EUR: "€",
  BRL: "R$",
  GBP: "£",
};

const PERIOD_TEXT: Readonly<Record<SalaryPeriodText, string>> = {
  mensual: "por mes",
  anual: "por año",
  hora: "por hora",
};

/** 1200000 → «1.200.000» (siempre con punto, sin depender del idioma de la máquina). */
function grouped(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function money(n: number, currency: string): string {
  const symbol = SYMBOLS[currency];
  return symbol ? `${symbol} ${grouped(n)}` : grouped(n);
}

/**
 * «$ 1.200.000 a $ 1.500.000 por mes (ARS)». Con un solo extremo: «desde …» o «hasta …»; con los dos
 * iguales, un solo monto. Sin periodicidad no la agrega. El código de la moneda siempre va al final,
 * porque «$» sirve para varias.
 */
export function formatSalaryOriginal(s: SalaryOriginal): string {
  const { min, max, currency } = s;
  let amount: string;
  if (min !== null && max !== null) {
    amount =
      min === max ? money(min, currency) : `${money(min, currency)} a ${money(max, currency)}`;
  } else if (min !== null) {
    amount = `desde ${money(min, currency)}`;
  } else if (max !== null) {
    amount = `hasta ${money(max, currency)}`;
  } else {
    amount = "";
  }
  const period = s.period ? ` ${PERIOD_TEXT[s.period]}` : "";
  return `${amount}${period} (${currency})`.trim();
}

/**
 * La equivalencia en dólares, solo si existe y el original no está ya en dólares. Va aparte del sueldo y dice
 * que es aproximada: nunca reemplaza al original. `null` si no hay nada que mostrar.
 */
export function formatSalaryEquivalence(
  original: SalaryOriginal,
  usd: { min: number | null; max: number | null; period: SalaryPeriodText | null },
): string | null {
  if (original.currency === "USD") return null;
  if (usd.min === null && usd.max === null) return null;
  const body = formatSalaryOriginal({
    min: usd.min,
    max: usd.max,
    currency: "USD",
    period: usd.period,
  }).replace(/ \(USD\)$/, "");
  return `Equivale a unos ${body} (aproximado)`;
}
