/**
 * Verificador de texto redactado por IA para el CV (C-25). Puro: compara lo que devolvió el modelo con las
 * respuestas de la persona. Si la viñeta trae un número, un nombre propio o una tecnología que las
 * respuestas no tenían, se descarta y queda el texto de la persona, apenas limpiado. El modelo evalúa,
 * el código decide: nada de lo que escribe el modelo llega al CV sin pasar por acá.
 */

export const CV_BULLET_MAX_CHARS = 220;
export const CV_SUMMARY_MAX_CHARS = 600;

export type CvRejectReason =
  | "empty"
  | "too_long"
  | "link_or_email"
  | "number_not_in_answers"
  | "name_not_in_answers"
  | "technology_not_in_answers";

export interface CvVerifyOptions {
  /** Tope de caracteres del texto final. */
  maxChars?: number;
  /** Nombres de skills/tecnologías conocidos (catálogo): si aparecen, tienen que estar en las respuestas. */
  knownTerms?: readonly string[];
}

export interface CvVerified {
  /** Lo que va al CV. */
  text: string;
  /** `generated` = lo del modelo pasó; `person` = se descartó y quedó el texto de la persona. */
  origin: "generated" | "person";
  rejected: CvRejectReason[];
}

const URL_RE = /(?:https?:\/\/|www\.)\S+/gi;
const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/g;
// Control, invisibles y marcas bidi (construido con RegExp para no escribir los caracteres en el fuente).
const CONTROL_RE = new RegExp(
  // eslint-disable-next-line no-control-regex
  "[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F\\u200B-\\u200F\\u202A-\\u202E\\u2060\\uFEFF]",
  "g",
);
const LEADING_MARK_RE = /^(?:[\s\-*•·▪●○◦–—]+|\d{1,2}[.)]\s+)/u;
const TOKEN_RE = /[\p{L}\p{N}][\p{L}\p{N}.+#_/-]*/gu;

/** Minúsculas y sin acentos, para comparar. */
export function foldCvText(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function cut(s: string, max: number): string {
  if (s.length <= max) return s;
  const slice = s.slice(0, max);
  const space = slice.lastIndexOf(" ");
  return (space > max * 0.6 ? slice.slice(0, space) : slice).replace(/[\s,;:.\-–—]+$/u, "");
}

/**
 * Limpieza del texto de la persona: sin caracteres de control ni invisibles, sin links ni emails, sin
 * marcador de viñeta, espacios colapsados, primera letra en mayúscula y tope de largo. No reescribe nada.
 */
export function cleanCvText(
  raw: string,
  maxChars: number = CV_BULLET_MAX_CHARS,
  capitalize = true,
): string {
  let s = raw.replace(CONTROL_RE, " ").replace(URL_RE, " ").replace(EMAIL_RE, " ");
  s = s.replace(/\s+/g, " ").trim();
  s = s.replace(LEADING_MARK_RE, "").trim();
  s = cut(s, maxChars);
  return capitalize && s.length > 0 ? s.charAt(0).toLocaleUpperCase() + s.slice(1) : s;
}

function tokens(s: string): string[] {
  return (s.match(TOKEN_RE) ?? []).map((t) => t.replace(/[.\-/_]+$/u, "")).filter((t) => t !== "");
}

function numbersOf(s: string): Set<string> {
  const out = new Set<string>();
  for (const m of s.matchAll(/\d+(?:[.,]\d+)*/g)) out.add(m[0].replace(/[.,]/g, ""));
  return out;
}

/** Forma de tecnología: `Node.js`, `C#`, `C++`, `PostgreSQL`, `S3`, `ES6`. */
function looksLikeTech(t: string): boolean {
  if (/\p{L}\.(?:js|net)$/iu.test(t)) return true;
  if (/[#+]/.test(t)) return true;
  if (/\p{L}/u.test(t) && /\d/.test(t) && !/^\d/.test(t)) return true;
  if (/^\p{Lu}[\p{Ll}\d]*\p{Lu}/u.test(t)) return true; // PostgreSQL, JavaScript
  if (/^\p{Lu}{2,}$/u.test(t)) return true; // SQL, AWS
  return false;
}

/** Tokens en posición de nombre propio: con mayúscula y no al arranque de una oración. */
function mid(text: string): string[] {
  const out: string[] = [];
  for (const sentence of text.split(/(?<=[.!?:;])\s+|\n+/u)) {
    tokens(sentence)
      .slice(1)
      .forEach((t) => {
        if (/^\p{Lu}/u.test(t)) out.push(t);
      });
  }
  return out;
}

function hasTerm(foldedText: string, foldedTerm: string): boolean {
  const esc = foldedTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\p{L}\\p{N}])${esc}(?![\\p{L}\\p{N}])`, "u").test(foldedText);
}

/**
 * Compara el texto del modelo con las respuestas de origen. Devuelve la lista de motivos de rechazo; vacía
 * si pasa. Reglas: sin links ni emails; todo número del texto existe en las respuestas; todo nombre propio
 * (mayúscula que no abre oración) y toda forma de tecnología existen en las respuestas; todo término del
 * catálogo que aparece también estaba en las respuestas. Es conservador: ante la duda descarta.
 */
export function cvRejectReasons(
  generated: string,
  sources: readonly string[],
  opts: CvVerifyOptions = {},
): CvRejectReason[] {
  const reasons = new Set<CvRejectReason>();
  const text = generated.replace(CONTROL_RE, " ").replace(/\s+/g, " ").trim();
  if (text === "") return ["empty"];
  if (text.length > (opts.maxChars ?? CV_BULLET_MAX_CHARS)) reasons.add("too_long");
  if (/(?:https?:\/\/|www\.)\S+/i.test(text) || /[^\s@]+@[^\s@]+\.[^\s@]+/.test(text)) {
    reasons.add("link_or_email");
  }

  const source = sources.join("\n");
  const foldedSource = foldCvText(source);
  const sourceTokens = new Set(tokens(foldedSource));

  const srcNumbers = numbersOf(source);
  for (const n of numbersOf(text)) if (!srcNumbers.has(n)) reasons.add("number_not_in_answers");

  for (const t of tokens(text)) {
    if (looksLikeTech(t) && !sourceTokens.has(foldCvText(t)))
      reasons.add("technology_not_in_answers");
  }
  for (const t of mid(text)) {
    if (!sourceTokens.has(foldCvText(t))) reasons.add("name_not_in_answers");
  }
  const foldedText = foldCvText(text);
  for (const term of opts.knownTerms ?? []) {
    const f = foldCvText(term).trim();
    if (f.length >= 2 && hasTerm(foldedText, f) && !hasTerm(foldedSource, f)) {
      reasons.add("technology_not_in_answers");
    }
  }
  return [...reasons];
}

/**
 * Una viñeta o resumen generado: si pasa, va tal cual (con la limpieza básica); si no, va `fallback`, el texto
 * de la persona, apenas limpiado. `sources` son las respuestas de origen (incluidos empresa, cargo y skills
 * que la persona confirmó para esa entrada).
 */
export function verifyCvText(
  generated: string,
  sources: readonly string[],
  fallback: string,
  opts: CvVerifyOptions = {},
): CvVerified {
  const max = opts.maxChars ?? CV_BULLET_MAX_CHARS;
  const rejected = cvRejectReasons(generated, sources, opts);
  if (rejected.length === 0)
    return { text: cleanCvText(generated, max), origin: "generated", rejected };
  return { text: cleanCvText(fallback, max), origin: "person", rejected };
}

/** Lo mismo para el resumen profesional (tope de 600). */
export function verifyCvSummary(
  generated: string,
  sources: readonly string[],
  fallback: string,
  opts: Omit<CvVerifyOptions, "maxChars"> = {},
): CvVerified {
  return verifyCvText(generated, sources, fallback, { ...opts, maxChars: CV_SUMMARY_MAX_CHARS });
}

export interface CvBulletPair {
  /** Lo que devolvió el modelo para esta viñeta. */
  generated: string;
  /** Lo que dijo la persona (respuesta de origen de esa viñeta). */
  person: string;
}

/**
 * Verifica las viñetas de una entrada contra todas las respuestas de la entrada (`sources`). Las vacías
 * (ni modelo ni persona) se quitan; se repiten una sola vez.
 */
export function verifyCvBullets(
  pairs: readonly CvBulletPair[],
  sources: readonly string[],
  opts: Omit<CvVerifyOptions, "maxChars"> = {},
): CvVerified[] {
  const seen = new Set<string>();
  const out: CvVerified[] = [];
  for (const p of pairs) {
    const v = verifyCvText(p.generated, [...sources, p.person], p.person, opts);
    const key = foldCvText(v.text);
    if (v.text === "" || seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}
