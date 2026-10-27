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
/**
 * Dominio suelto (`ejemplo.com`, `perfil.io/x`): sin esquema ni `www.`. Las extensiones van en minúscula y
 * son una lista corta a propósito, para no tocar `Node.js`, `ASP.NET`, `S.A.` ni «etc.».
 */
const DOMAIN_SRC =
  "(?<![\\p{L}\\p{N}@.-])[\\p{L}\\p{N}-]+(?:\\.[\\p{L}\\p{N}-]+)*\\.(?:com|io|ar|net|org|dev|ly|me|app|co|ai|edu|gov|info|xyz|cloud|tech|site)(?![\\p{L}\\p{N}])\\S*";
const DOMAIN_RE = new RegExp(DOMAIN_SRC, "gu");

/** ¿Trae un link (con o sin esquema) o un email? Lo usan el verificador y la carga manual del historial. */
export function hasLinkOrEmail(text: string): boolean {
  return (
    /(?:https?:\/\/|www\.)\S+/i.test(text) ||
    /[^\s@]+@[^\s@]+\.[^\s@]+/.test(text) ||
    new RegExp(DOMAIN_SRC, "u").test(text)
  );
}

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
  let s = raw
    .replace(CONTROL_RE, " ")
    .replace(URL_RE, " ")
    .replace(EMAIL_RE, " ")
    .replace(DOMAIN_RE, " ");
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

/** Primer token de cada oración cuando empieza con mayúscula (puede ser un nombre propio al arranque). */
function leading(text: string): string[] {
  const out: string[] = [];
  for (const sentence of text.split(/(?<=[.!?:;])\s+|\n+/u)) {
    const first = tokens(sentence)[0];
    if (first && /^\p{Lu}/u.test(first) && !/\d/.test(first)) out.push(first);
  }
  return out;
}

// Verbos de acción irregulares que abren viñetas de CV (pretérito en español, pasado en inglés).
const IRREGULAR_VERBS = new Set(
  (
    "hice cree puse tuve pude supe quise dije traje di fui vi " +
    "led built ran wrote made cut grew drove won set sold taught spoke held took got gave began " +
    "chose found kept taught thought understood oversaw"
  ).split(" "),
);

/**
 * Al arranque de una viñeta casi siempre va un verbo («Automaticé», «Led») que el modelo conjuga distinto de
 * la respuesta. Se acepta si está en las respuestas o si comparte las primeras 4 letras con alguna palabra
 * de ellas; si no, puede ser un nombre propio inventado y se descarta (un falso positivo cae al texto de
 * la persona).
 */
function leadingTokenInAnswers(token: string, sourceTokens: ReadonlySet<string>): boolean {
  const f = foldCvText(token);
  if (sourceTokens.has(f)) return true;
  // Forma de verbo conjugado: pretérito en español («Automaticé», «Lideraron») o -ed en inglés («Managed»)
  if (
    /(?:[éíó]|aron|ieron|uje)$/u.test(token) ||
    (token.length >= 5 && /ed$/u.test(token)) ||
    IRREGULAR_VERBS.has(f)
  ) {
    return true;
  }
  const prefix = f.slice(0, 4);
  for (const s of sourceTokens) if (s.startsWith(prefix)) return true;
  return false;
}

// Números en letras (es/en). Quedan afuera «uno», «una» y «one»: también son artículos y pronombres.
const NUMBER_WORDS = new Set(
  (
    "dos tres cuatro cinco seis siete ocho nueve diez once doce trece catorce quince veinte treinta " +
    "cuarenta cincuenta sesenta setenta ochenta noventa cien ciento cientos mil millon millones " +
    "two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen " +
    "seventeen eighteen nineteen twenty thirty forty fifty sixty seventy eighty ninety hundred " +
    "thousand million"
  ).split(" "),
);

function isNumberWord(t: string): boolean {
  return NUMBER_WORDS.has(t) || /^(?:veinti|dieci)\p{L}+$/u.test(t) || /cientos$/u.test(t);
}

/** Números escritos en letras que trae el texto (en minúscula y sin acentos; `twenty-five` cuenta por partes). */
function numberWordsOf(text: string): Set<string> {
  const out = new Set<string>();
  for (const t of tokens(foldCvText(text))) {
    for (const part of t.split("-")) if (isNumberWord(part)) out.add(part);
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
  if (hasLinkOrEmail(text)) reasons.add("link_or_email");

  const source = sources.join("\n");
  const foldedSource = foldCvText(source);
  const sourceTokens = new Set(tokens(foldedSource));

  const srcNumbers = numbersOf(source);
  for (const n of numbersOf(text)) if (!srcNumbers.has(n)) reasons.add("number_not_in_answers");
  for (const w of numberWordsOf(text)) {
    if (!sourceTokens.has(w)) reasons.add("number_not_in_answers");
  }

  for (const t of tokens(text)) {
    if (looksLikeTech(t) && !sourceTokens.has(foldCvText(t)))
      reasons.add("technology_not_in_answers");
  }
  for (const t of mid(text)) {
    if (!sourceTokens.has(foldCvText(t))) reasons.add("name_not_in_answers");
  }
  for (const t of leading(text)) {
    if (!leadingTokenInAnswers(t, sourceTokens)) reasons.add("name_not_in_answers");
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
