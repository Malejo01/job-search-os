import { err, ok, type Result } from "./result";

/**
 * Calculadora de margen por plan (tablero de costos). Pura: sin red ni fecha. El tipo de cambio es un campo
 * manual. Margen de contribución por persona = `precio × (1 − comisión) − costo de IA en ARS`, antes de
 * impuestos propios. Los valores por defecto y de dónde salen están en `docs/beta/costos.md`
 * («Calculadora de margen»).
 */
export type MarginInput = {
  /** Precio del plan por mes, en ARS. 0 = beca. */
  priceArs: number;
  /** Pesos por dólar, cargado a mano. */
  exchangeRate: number;
  /** Uso por persona y por mes. */
  usage: { offers: number; interviews: number; coachChats: number };
  /** Costo de IA por unidad, en USD. */
  unitCostUsd: { offer: number; interview: number; coach: number };
  /** Costos fijos mensuales, en USD, cargados a mano. */
  fixedUsd: { vercel: number; neon: number; other: number };
  /** Comisión de Mercado Pago, en porcentaje (6,29 = 6,29 %). */
  mpCommissionPct: number;
};

export type BreakEven =
  /** Personas pagas necesarias para cubrir los fijos (redondeado hacia arriba). */
  | { kind: "personas"; people: number }
  /** El margen por persona no es positivo: ninguna cantidad de personas cubre los fijos. */
  | { kind: "no_alcanza" };

export type MarginResult = {
  aiCostUsd: number;
  aiCostArs: number;
  commissionArs: number;
  netRevenueArs: number;
  marginArs: number;
  /** Sobre el precio; null si el precio es 0. */
  marginPct: number | null;
  fixedUsd: number;
  fixedArs: number;
  breakEven: BreakEven;
};

/** Valores de referencia (fuentes en docs/beta/costos.md). Cambiarlos no cambia ningún tope ni precio real. */
export const MARGIN_DEFAULTS: MarginInput = {
  priceArs: 20_000,
  exchangeRate: 1_570,
  usage: { offers: 219, interviews: 4, coachChats: 2 },
  unitCostUsd: { offer: 0.0245, interview: 0.04, coach: 0.043 },
  fixedUsd: { vercel: 20, neon: 9.89, other: 2.85 },
  mpCommissionPct: 6.29,
};

const finiteNonNeg = (n: number) => Number.isFinite(n) && n >= 0;

export function computeMargin(input: MarginInput): Result<MarginResult, string> {
  const { priceArs, exchangeRate, usage, unitCostUsd, fixedUsd, mpCommissionPct } = input;
  if (!finiteNonNeg(priceArs)) return err("precio inválido");
  if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) return err("tipo de cambio inválido");
  if (!Number.isFinite(mpCommissionPct) || mpCommissionPct < 0 || mpCommissionPct >= 100) {
    return err("comisión inválida");
  }
  for (const v of [
    ...Object.values(usage),
    ...Object.values(unitCostUsd),
    ...Object.values(fixedUsd),
  ]) {
    if (!finiteNonNeg(v)) return err("valor negativo o no numérico");
  }

  const aiCostUsd =
    usage.offers * unitCostUsd.offer +
    usage.interviews * unitCostUsd.interview +
    usage.coachChats * unitCostUsd.coach;
  const aiCostArs = aiCostUsd * exchangeRate;
  const commissionArs = (priceArs * mpCommissionPct) / 100;
  const netRevenueArs = priceArs - commissionArs;
  const marginArs = netRevenueArs - aiCostArs;
  const fixedTotalUsd = fixedUsd.vercel + fixedUsd.neon + fixedUsd.other;
  const fixedArs = fixedTotalUsd * exchangeRate;

  let breakEven: BreakEven;
  if (marginArs <= 0) breakEven = { kind: "no_alcanza" };
  else
    breakEven = { kind: "personas", people: Math.max(0, Math.ceil(fixedArs / marginArs - 1e-9)) };

  return ok({
    aiCostUsd,
    aiCostArs,
    commissionArs,
    netRevenueArs,
    marginArs,
    marginPct: priceArs > 0 ? (marginArs / priceArs) * 100 : null,
    fixedUsd: fixedTotalUsd,
    fixedArs,
    breakEven,
  });
}

/**
 * Número tal como lo escribe una persona en Argentina: «0,0245», «0.5», «20.000», «1.570,5». Solo no
 * negativos y finitos; todo lo demás es null (sin notación científica, hexadecimal ni signos).
 */
export function parseDecimalInput(raw: string | undefined): number | null {
  if (typeof raw !== "string") return null;
  let s = raw.trim();
  if (s === "" || s.length > 20) return null;
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d+([.,]\d+)?$/.test(s)) s = s.replace(",", ".");
  else return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

type Raw = Record<string, string | string[] | undefined>;

/**
 * Lee los valores del formulario GET (`searchParams`). Cada campo se valida y acota por separado: ante un
 * valor inválido, o fuera de rango, ese campo queda con su valor por defecto. Nunca falla.
 */
export function parseMarginParams(raw: Raw, defaults: MarginInput): MarginInput {
  const get = (key: string): string | undefined => {
    const v = raw[key];
    return Array.isArray(v) ? v[0] : v;
  };
  const num = (key: string, fallback: number, min: number, max: number, integer = false) => {
    const n = parseDecimalInput(get(key));
    if (n === null) return fallback;
    const v = integer ? Math.round(n) : n;
    return v >= min && v <= max ? v : fallback;
  };
  return {
    priceArs: num("precio", defaults.priceArs, 0, 10_000_000),
    exchangeRate: num("tc", defaults.exchangeRate, 1, 100_000),
    usage: {
      offers: num("ofertas", defaults.usage.offers, 0, 10_000, true),
      interviews: num("simulaciones", defaults.usage.interviews, 0, 10_000, true),
      coachChats: num("charlas", defaults.usage.coachChats, 0, 10_000, true),
    },
    unitCostUsd: {
      offer: num("c_oferta", defaults.unitCostUsd.offer, 0, 10),
      interview: num("c_simulacion", defaults.unitCostUsd.interview, 0, 10),
      coach: num("c_charla", defaults.unitCostUsd.coach, 0, 10),
    },
    fixedUsd: {
      vercel: num("vercel", defaults.fixedUsd.vercel, 0, 100_000),
      neon: num("neon", defaults.fixedUsd.neon, 0, 100_000),
      other: num("otros", defaults.fixedUsd.other, 0, 100_000),
    },
    mpCommissionPct: num("comision", defaults.mpCommissionPct, 0, 50),
  };
}
