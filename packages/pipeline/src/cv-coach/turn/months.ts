/**
 * Meses del coach de CV. Puro. Formatea `AAAA-MM` para el acuse y la contradicción («abril de 2025»), y lee
 * fechas de una frase dicha fuera de foco («en Empresa B empecé en marzo de 2023 y sigo»). La lectura es
 * deliberadamente estrecha: solo meses con nombre y año de cuatro cifras, o `MM/AAAA`. Si la frase no es
 * clara, no hay fechas (la frase queda como nota para revisar, nunca se adivina).
 */
import { foldCvText } from "../../cv-out/verify";

export const MONTH_NAMES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
] as const;

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** «abril de 2025»; `null` si no es un mes válido. */
export function formatCoachMonth(month: string | null): string | null {
  const m = month ? MONTH_RE.exec(month) : null;
  if (!m) return null;
  return `${MONTH_NAMES[Number(m[2]) - 1]} de ${m[1]}`;
}

/** «abril de 2025 a marzo de 2026», «abril de 2025 a la actualidad», «desde abril de 2025»… */
export function formatCoachRange(r: {
  startMonth: string | null;
  endMonth: string | null;
  isCurrent: boolean;
}): string | null {
  const start = formatCoachMonth(r.startMonth);
  const end = formatCoachMonth(r.endMonth);
  if (start && r.isCurrent) return `${start} a la actualidad`;
  if (start && end) return `${start} a ${end}`;
  if (start) return `desde ${start}`;
  if (end) return `hasta ${end}`;
  return r.isCurrent ? "a la actualidad" : null;
}

const NAMED_RE = new RegExp(
  `\\b(${MONTH_NAMES.join("|")}|setiembre)\\s+(?:de\\s+|del\\s+)?(\\d{4})\\b`,
  "g",
);
const NUMERIC_RE = /\b(0?[1-9]|1[0-2])\/(\d{4})\b/g;
const CURRENT_RE = /\b(actualidad|actualmente|sigo|seguimos|sigue|hoy|presente|en curso)\b/;
const START_RE = /\b(desde|empece|empezo|arranque|arranco|inicio|inicie|entre en)\b/;
const END_RE = /\b(hasta|termine|termino|deje|sali|finalice|finalizo)\b/;

const pad = (n: number): string => String(n).padStart(2, "0");

export type ParsedRange = {
  startMonth: string | null;
  endMonth: string | null;
  isCurrent: boolean;
};

/**
 * Fechas de una frase: dos meses → inicio y fin (en ese orden, si el fin no es anterior); un mes con «sigo»
 * → inicio y actual; un mes con «desde» / «empecé» → inicio; un mes con «hasta» / «terminé» → fin.
 * Cualquier otra cosa → `null`.
 */
export function parseCoachRange(text: string): ParsedRange | null {
  const folded = foldCvText(text);
  const found: { at: number; month: string }[] = [];
  for (const m of folded.matchAll(NAMED_RE)) {
    const name = m[1] === "setiembre" ? "septiembre" : m[1]!;
    const idx = (MONTH_NAMES as readonly string[]).indexOf(name);
    found.push({ at: m.index ?? 0, month: `${m[2]}-${pad(idx + 1)}` });
  }
  for (const m of folded.matchAll(NUMERIC_RE)) {
    found.push({ at: m.index ?? 0, month: `${m[2]}-${pad(Number(m[1]))}` });
  }
  found.sort((a, b) => a.at - b.at);
  const current = CURRENT_RE.test(folded);
  if (found.length === 2) {
    const [a, b] = [found[0]!.month, found[1]!.month];
    if (b < a || current) return null;
    return { startMonth: a, endMonth: b, isCurrent: false };
  }
  if (found.length !== 1) return null;
  const only = found[0]!.month;
  if (current) return { startMonth: only, endMonth: null, isCurrent: true };
  const start = START_RE.test(folded);
  const end = END_RE.test(folded);
  if (start && !end) return { startMonth: only, endMonth: null, isCurrent: false };
  if (end && !start) return { startMonth: null, endMonth: only, isCurrent: false };
  return null;
}
