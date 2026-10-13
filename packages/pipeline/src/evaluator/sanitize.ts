import type { Evaluation } from "../evaluation";

const LINK_REMOVED = "[enlace quitado]";
const MAX_TEXT = 160;
const MAX_VERDICT = 200;

const LIMITS = {
  bloqueadores_duros: 10,
  riesgos: 10,
  senales_positivas: 10,
  paises_permitidos: 40,
  match_fuerte: 8,
  gaps: 8,
} as const;
type ListField = keyof typeof LIMITS;

/** Controles C0/C1 (menos tab y salto de línea), espacios de ancho cero y marcas bidireccionales. */
const isInvisible = (code: number): boolean =>
  (code <= 0x1f && code !== 0x09 && code !== 0x0a) ||
  (code >= 0x7f && code <= 0x9f) ||
  (code >= 0x200b && code <= 0x200f) ||
  (code >= 0x2028 && code <= 0x202e) ||
  (code >= 0x2066 && code <= 0x2069) ||
  (code >= 0x2060 && code <= 0x2065) ||
  code === 0x00ad ||
  code === 0xfeff ||
  (code >= 0xe0000 && code <= 0xe007f);

const stripInvisible = (text: string): string =>
  Array.from(text)
    .filter((ch) => !isInvisible(ch.codePointAt(0) ?? 0))
    .join("");

/** Cualquier esquema con "://", javascript:/data:, hxxp defanged, "[.]" y dominios con TLD común. */
const URL_RE = new RegExp(
  [
    String.raw`[a-z][a-z0-9+.-]*:\/\/\S*`,
    String.raw`\b(?:javascript|data):\S*`,
    String.raw`\bhxxps?\S*`,
    String.raw`\bwww\.\S*`,
    String.raw`\b[\w-]+(?:(?:\[\.\]|\(\.\)|\.)[\w-]+)*\[\.\][\w-]+\S*`,
    String.raw`\b[\w-]+(?:\.[\w-]+)+\.(?:com|net|org|io|ar|co|me|app|dev|info|xyz)\b(?:\/\S*)?`,
    String.raw`\b[\w-]+\.(?:com|net|org|io|ar|co|me|app|dev|info|xyz)\/\S*`,
  ].join("|"),
  "gi",
);
const EMAIL_RE = /[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>()]+/g;

/** Limpia un texto libre; devuelve el texto y si algo cambió. */
function cleanText(value: string, max: number): { text: string; changed: boolean } {
  const text = stripInvisible(value)
    .replace(URL_RE, LINK_REMOVED)
    .replace(EMAIL_RE, LINK_REMOVED)
    .trim();
  const cut = text.length > max ? text.slice(0, max).trimEnd() : text;
  return { text: cut, changed: cut !== value };
}

/**
 * Saneado de la salida del modelo antes de `decide()` y de persistir: el texto libre puede venir
 * contaminado por el aviso (enlaces, instrucciones largas). Nunca rechaza ni lanza: a temperatura 0
 * un rechazo repetiría el gasto. Devuelve los NOMBRES de los campos tocados, nunca su contenido.
 */
export function sanitizeEvaluation(e: Evaluation): { evaluation: Evaluation; sanitized: string[] } {
  const touched = new Set<string>();

  const list = (field: ListField, values: readonly string[]): string[] => {
    const out = values.map((v) => {
      const r = cleanText(String(v), MAX_TEXT);
      if (r.changed) touched.add(field);
      return r.text;
    });
    if (out.length > LIMITS[field]) touched.add(field);
    return out.slice(0, LIMITS[field]);
  };

  const verdict = cleanText(String(e.veredicto), MAX_VERDICT);
  if (verdict.changed) touched.add("veredicto");

  if (e.gaps.length > LIMITS.gaps) touched.add("gaps");
  const gaps = e.gaps.slice(0, LIMITS.gaps).map((g) => {
    const r = cleanText(String(g.skill), MAX_TEXT);
    if (r.changed) touched.add("gaps");
    return { ...g, skill: r.text };
  });

  let yearsDomain = e.years_domain;
  if (yearsDomain !== null) {
    const r = cleanText(String(yearsDomain), MAX_TEXT);
    if (r.changed) touched.add("years_domain");
    yearsDomain = r.text;
  }

  const evaluation: Evaluation = {
    ...e,
    veredicto: verdict.text,
    match_fuerte: list("match_fuerte", e.match_fuerte),
    gaps,
    bloqueadores_duros: list("bloqueadores_duros", e.bloqueadores_duros),
    riesgos: list("riesgos", e.riesgos),
    senales_positivas: list("senales_positivas", e.senales_positivas),
    paises_permitidos: e.paises_permitidos
      ? list("paises_permitidos", e.paises_permitidos)
      : e.paises_permitidos,
    years_domain: yearsDomain,
  };
  return { evaluation, sanitized: [...touched] };
}
