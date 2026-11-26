/**
 * Lee un sueldo escrito como texto («61.200–94.500 USD», «61k-94k USD», «$ 1.200.000 a $ 1.500.000 por mes»).
 * Puro, sin red ni fecha. Falla cerrado (R30-13): si algo no se entiende devuelve `{ ok: false, reason }` y el
 * sueldo queda sin informar; nunca un número a medias (un solo extremo inventado, una moneda supuesta, un monto
 * con un separador que podría ser miles o decimales).
 *
 * Lo que entiende:
 * - miles con punto o coma («73.600», «73,600»); si hay los dos, el último es el decimal («73.600,50»);
 * - «k» y «mil» («73k», «73.6k», «73 mil»); la «k» final vale para los dos extremos si el primero no la lleva
 *   («73-105k»);
 * - guion corto o largo, «a», «to», «y» y «hasta» entre los dos extremos; «desde» y «+» (solo mínimo) y
 *   «hasta» (solo máximo) con un único monto;
 * - moneda por código, símbolo o palabra; «$» solo no dice la moneda y queda `null` (no se supone);
 * - periodicidad («por mes», «/month», «anual», «por hora»…); sin ella queda `null`.
 *
 * El texto viene de afuera: es un dato, nunca una instrucción. Solo se leen montos, moneda y período.
 */

export type SalaryCurrency =
  "USD" | "ARS" | "EUR" | "BRL" | "GBP" | "MXN" | "CLP" | "COP" | "UYU" | "PEN";
export type SalaryPeriodText = "mensual" | "anual" | "hora";

export type SalaryText = {
  min: number | null;
  max: number | null;
  currency: SalaryCurrency | null;
  period: SalaryPeriodText | null;
};

export type SalaryTextFailure =
  | "vacio"
  | "sin_monto"
  | "demasiados_montos"
  | "monto_ambiguo"
  | "k_inconsistente"
  | "monedas_distintas"
  | "periodos_distintos"
  | "rango_ilegible"
  | "rango_invertido";

export type SalaryTextResult =
  { ok: true; salary: SalaryText } | { ok: false; reason: SalaryTextFailure };

const fail = (reason: SalaryTextFailure): SalaryTextResult => ({ ok: false, reason });

/** Sin tildes, en minúsculas y con un solo tipo de guion. */
function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[‐-―−]/g, "-")
    .toLowerCase();
}

// Un monto: un bloque de dígitos con puntos y comas, y opcionalmente «k» o «mil»
const AMOUNT = /(?<![\d.,])(\d[\d.,]*\d|\d)(?:\s*(k|mil)(?![a-z]))?/g;

type Token = { start: number; end: number; value: number; hasK: boolean };

/** El monto con su «k» aplicada (redondeado: 73,6 × 1000 no puede dar 73600,00000000001). */
const scaled = (t: Token): number => (t.hasK ? Math.round(t.value * 1000) : t.value);

/** Valor de un bloque numérico, o `null` si el separador podría ser miles o decimales. */
function numberOf(blob: string, hasK: boolean): number | null {
  const dots = (blob.match(/\./g) ?? []).length;
  const commas = (blob.match(/,/g) ?? []).length;
  let value: number;
  if (dots + commas === 0) {
    value = Number(blob);
  } else if (dots > 0 && commas > 0) {
    // Los dos: el último es el decimal y el otro separa miles
    const decimalSep = blob.lastIndexOf(".") > blob.lastIndexOf(",") ? "." : ",";
    const thousandsSep = decimalSep === "." ? "," : ".";
    if ((blob.match(decimalSep === "." ? /\./g : /,/g) ?? []).length !== 1) return null;
    const [int, dec] = blob.split(decimalSep) as [string, string];
    const grouped = new RegExp(`^\\d{1,3}(?:\\${thousandsSep}\\d{3})+$`);
    if (!grouped.test(int) || dec.length < 1 || dec.length > 2) return null;
    value = Number(`${int.split(thousandsSep).join("")}.${dec}`);
  } else {
    const sep = dots > 0 ? "." : ",";
    const parts = blob.split(sep);
    const [first, ...rest] = parts as [string, ...string[]];
    if (parts.length === 2 && rest[0]!.length >= 1 && rest[0]!.length <= 2) {
      // Un solo separador con 1 o 2 dígitos detrás: decimal («12,5», «73.6k»)
      value = Number(`${first}.${rest[0]}`);
    } else if (first.length >= 1 && first.length <= 3 && rest.every((g) => g.length === 3)) {
      // Grupos de tres: miles. Con «k» sería «73.600k»: no se entiende
      if (hasK) return null;
      value = Number(parts.join(""));
    } else {
      return null;
    }
  }
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

const CURRENCIES: readonly [SalaryCurrency, RegExp][] = [
  ["USD", /usd|us\$|u\$s|u\$d|(?<![a-z])dolar|(?<![a-z])dollar/],
  ["ARS", /(?<![a-z])(?:ars|pesos?)(?![a-z])/],
  ["EUR", /(?<![a-z])(?:eur|euros?)(?![a-z])|€/],
  ["BRL", /(?<![a-z])(?:brl|reales)(?![a-z])|r\$/],
  ["GBP", /(?<![a-z])(?:gbp|libras)(?![a-z])|£/],
  ["MXN", /(?<![a-z])mxn(?![a-z])/],
  ["CLP", /(?<![a-z])clp(?![a-z])/],
  ["COP", /(?<![a-z])cop(?![a-z])/],
  ["UYU", /(?<![a-z])uyu(?![a-z])/],
  ["PEN", /(?<![a-z])pen(?![a-z])/],
];

/** Palabras y símbolos de moneda, para sacarlos de lo que hay entre los dos montos. */
const CURRENCY_NOISE =
  /usd|us\$|u\$s|u\$d|r\$|[$€£]|(?<![a-z])(?:dolares?|dollars?|ars|pesos?|eur|euros?|brl|reales|gbp|libras|mxn|clp|cop|uyu|pen)(?![a-z])/g;

const PERIODS: readonly [SalaryPeriodText, RegExp][] = [
  [
    "mensual",
    /\/\s*(?:mes|month|mo)(?![a-z])|(?<![a-z])(?:por mes|al mes|x mes|mensual(?:es)?|monthly|per month|a month|each month)(?![a-z])/,
  ],
  [
    "anual",
    /\/\s*(?:ano|year|yr)(?![a-z])|(?<![a-z])(?:por ano|al ano|x ano|anual(?:es)?|annual(?:ly)?|yearly|per year|a year|per annum)(?![a-z])/,
  ],
  [
    "hora",
    /\/\s*(?:hora|hour|hr|h)(?![a-z])|(?<![a-z])(?:por hora|x hora|hourly|per hour|an hour)(?![a-z])/,
  ],
];

/** Lo mismo, para sacar la periodicidad de lo que hay entre los dos montos. */
const PERIOD_NOISE = new RegExp(PERIODS.map(([, re]) => re.source).join("|"), "g");

const RANGE_WORDS = new Set(["-", "a", "to", "y", "and", "hasta", "~"]);

export function parseSalaryText(input: string): SalaryTextResult {
  const text = fold(input).trim();
  if (!text) return fail("vacio");

  const tokens: Token[] = [];
  const blobs: string[] = [];
  for (const m of text.matchAll(AMOUNT)) {
    blobs.push(m[1]!);
    tokens.push({
      start: m.index,
      end: m.index + m[0].length,
      value: 0,
      hasK: m[2] !== undefined,
    });
  }
  if (tokens.length === 0) return fail("sin_monto");
  if (tokens.length > 2) return fail("demasiados_montos");

  for (const [i, t] of tokens.entries()) {
    const n = numberOf(blobs[i]!, t.hasK);
    if (n === null) return fail("monto_ambiguo");
    t.value = n;
  }

  const currencies = CURRENCIES.filter(([, re]) => re.test(text)).map(([c]) => c);
  if (currencies.length > 1) return fail("monedas_distintas");
  const currency = currencies[0] ?? null;

  const periods = PERIODS.filter(([, re]) => re.test(text)).map(([p]) => p);
  if (periods.length > 1) return fail("periodos_distintos");
  const period = periods[0] ?? null;

  const [a, b] = tokens as [Token, Token | undefined];

  // Un solo monto: mínimo y máximo, salvo «desde» y «+» (solo mínimo) o «hasta» (solo máximo)
  if (!b) {
    const before = text.slice(0, a.start);
    const only = scaled(a);
    const after = text.slice(a.end).trimStart();
    let min: number | null = only;
    let max: number | null = only;
    if (
      /(?<![a-z])(?:desde|from|a partir de|starting at|minimo)(?![a-z])/.test(before) ||
      after.startsWith("+")
    ) {
      max = null;
    } else if (/(?<![a-z])(?:hasta|up to|maximo|max)(?![a-z])/.test(before)) {
      min = null;
    }
    return { ok: true, salary: { min, max, currency, period } };
  }

  // Dos montos: tienen que formar un rango
  const between = text
    .slice(a.end, b.start)
    .replace(CURRENCY_NOISE, " ")
    .replace(PERIOD_NOISE, " ")
    .replace(/\s+/g, "");
  if (!RANGE_WORDS.has(between)) return fail("rango_ilegible");

  let lo = scaled(a);
  let hi = scaled(b);
  if (a.hasK !== b.hasK) {
    // Una sola «k»: el extremo que no la lleva tiene que ser chico («73-105k»); si ya es grande, no se sabe
    const bare = a.hasK ? b : a;
    if (bare.value >= 1000) return fail("k_inconsistente");
    if (a.hasK) hi = Math.round(b.value * 1000);
    else lo = Math.round(a.value * 1000);
  }
  if (lo > hi) return fail("rango_invertido");
  return { ok: true, salary: { min: lo, max: hi, currency, period } };
}

/**
 * Solo USD con período claro llena los campos numéricos del aviso (D-017); lo demás queda como nota. Un extremo
 * que el texto no dice queda `null`.
 */
export function salaryUsdFromText(input: string): {
  salaryMinUsd: number | null;
  salaryMaxUsd: number | null;
  salaryPeriod: SalaryPeriodText;
} | null {
  const r = parseSalaryText(input);
  if (!r.ok || r.salary.currency !== "USD" || r.salary.period === null) return null;
  return {
    salaryMinUsd: r.salary.min,
    salaryMaxUsd: r.salary.max,
    salaryPeriod: r.salary.period,
  };
}
