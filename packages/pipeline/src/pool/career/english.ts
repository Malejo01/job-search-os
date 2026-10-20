import { foldText } from "../../normalize/text";
import type { EnglishLevel } from "./types";

/**
 * Inglés en un aviso del pool (ronda 58): en qué idioma está escrito, si pide inglés y con qué nivel.
 * Determinista y conservador; sin LLM. Mientras no se mida su precisión, la UI lo muestra como
 * estimado.
 */

/**
 * La UI dice "estimado" si la precisión medida queda por debajo del 85 %. Medida el 16/10 a mano
 * sobre 30 avisos reales del pool que mencionan el idioma (muestra de control, distinta de la
 * que se usó para ajustar las reglas): 29 de 30 en "pide inglés" y en el nivel. Volver a medir
 * si se cambian las reglas.
 */
export const ENGLISH_ESTIMATED = false;

export type EnglishDetection = {
  language: "en" | "es" | null;
  asks: boolean;
  level: EnglishLevel | null;
};

const EN_WORDS = new Set([
  "the",
  "and",
  "you",
  "with",
  "will",
  "our",
  "for",
  "are",
  "your",
  "to",
  "of",
  "we",
  "this",
  "have",
  "is",
]);
const ES_WORDS = new Set([
  "de",
  "la",
  "el",
  "y",
  "con",
  "para",
  "que",
  "los",
  "las",
  "una",
  "en",
  "del",
  "por",
  "tu",
  "nuestro",
  "es",
]);
const MIN_HITS = 8;
const MIN_RATIO = 2;
const EXCLUDE_WINDOW = 25;

/** Largo máximo del aviso que se analiza; el resto se ignora (un texto hostil no cuelga el cálculo). */
export const MAX_JD_CHARS = 30_000;
const MAX_FRAGMENT_CHARS = 1_500;
/** Menciones de english y palabras de nivel que se consideran por fragmento. */
const MAX_SPANS = 20;

function chunks(text: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

/** Menciones que nombran el idioma sin pedirlo. */
const NOT_A_REQUIREMENT =
  /english (?:version|below|translation|site|only|classes|lessons)|plain[ -]english|(?:version|traduccion|sitio|clases) (?:de |en )?ingles|in english below|en ingles abajo|english-language|spanish-speaking|(?:cv|resume) (?:in|en) (?:english|ingles)/;

/** Palabras de nivel; "strong", "excellent", "good" y similares no dan nivel. */
const LEVEL_TERMS: readonly { level: EnglishLevel; pattern: RegExp }[] = [
  {
    level: "fluido",
    pattern: /\b(?:c2|fluido|fluent|fluency|nativo|native|bilingue|bilingual|full professional)\b/g,
  },
  {
    level: "avanzado",
    pattern:
      /\b(?:b2|c1|avanzado|advanced|upper[ -]intermediate|professional|business[ -]level|working proficiency)\b/g,
  },
  {
    level: "intermedio",
    pattern: /\b(?:b1|intermedio|intermediate|conversacional|conversational)\b/g,
  },
  { level: "basico", pattern: /\b(?:a1|a2|basico|basic|elementary)\b/g },
];

/** Palabras que hacen de la mención un requisito aunque no traigan nivel. */
const CONTEXT =
  /\b(?:proficien\w*|level|skills?|communication|written|spoken|verbal|speak\w*|required|requirement\w*|must|strong|excellent|good|manejo|dominio|nivel|conocimientos?|excluyente|indispensable|deseable|requerido|oral|escrito|hablar|comunicacion|idioma|language|lees|leer|tecnico)\b/;

const OTHER_LANGUAGE =
  /\b(?:spanish|espanol|german|aleman|french|frances|portuguese|portugues|italian|italiano|chinese|chino|japanese|japones|korean|coreano|dutch)\b/g;
const ENGLISH_WORD = /\b(?:english|ingles)\b/g;

/** Palabras que pueden ir entre un nivel y "english" en "fluent in Spanish, Italian and English". */
const LIST_GLUE = new Set(["in", "of", "both", "and", "or", "y", "e", "o", "de", "en", "ambos"]);
const LANGUAGE_NAMES = new Set([
  "spanish",
  "espanol",
  "german",
  "aleman",
  "french",
  "frances",
  "portuguese",
  "portugues",
  "italian",
  "italiano",
  "chinese",
  "chino",
  "japanese",
  "japones",
  "korean",
  "coreano",
  "dutch",
]);

type Span = { start: number; end: number };

/** Las primeras `MAX_SPANS` coincidencias: el costo por fragmento queda acotado. */
function spansOf(text: string, pattern: RegExp, limit = MAX_SPANS): Span[] {
  const out: Span[] = [];
  for (const m of text.matchAll(pattern)) {
    out.push({ start: m.index, end: m.index + m[0].length });
    if (out.length >= limit) break;
  }
  return out;
}

const gap = (a: Span, b: Span) => Math.max(0, Math.max(a.start, b.start) - Math.min(a.end, b.end));

const nearest = (from: Span, spans: readonly Span[]) =>
  spans.reduce((best, s) => Math.min(best, gap(from, s)), Number.POSITIVE_INFINITY);

/** ¿Entre el nivel y el "english" que le sigue solo hay una lista de idiomas? */
function levelIntroducesList(fragment: string, level: Span, english: readonly Span[]): boolean {
  return english.some((e) => {
    if (e.start < level.end) return false;
    const tokens = fragment.slice(level.end, e.start).match(/[a-z0-9]+/g) ?? [];
    return tokens.every((t) => LIST_GLUE.has(t) || LANGUAGE_NAMES.has(t) || t === "language");
  });
}

/**
 * Nivel más alto de un fragmento, sin tomar el de otro idioma: una palabra de nivel más cerca de
 * otro idioma que de "english" no cuenta, salvo que introduzca una lista que incluye english.
 */
function fragmentLevel(fragment: string, english: readonly Span[]): number {
  const others = spansOf(fragment, OTHER_LANGUAGE);
  const levelWords = LEVEL_TERMS.flatMap(({ level, pattern }) =>
    spansOf(fragment, pattern).map((span) => ({ level, span })),
  )
    .sort((a, b) => a.span.start - b.span.start)
    .slice(0, MAX_SPANS);
  let best = -1;
  for (const { level, span } of levelWords) {
    const stolen =
      others.length > 0 &&
      nearest(span, others) < nearest(span, english) &&
      !levelIntroducesList(fragment, span, english);
    if (!stolen) best = Math.max(best, LEVEL_ORDER.indexOf(level));
  }
  return best;
}

const LEVEL_ORDER: readonly EnglishLevel[] = ["basico", "intermedio", "avanzado", "fluido"];

function detectLanguage(folded: string, lang: string | null): "en" | "es" | null {
  const code = lang?.trim().toLowerCase().slice(0, 2);
  if (code === "en" || code === "es") return code;
  let en = 0;
  let es = 0;
  for (const word of folded.match(/[a-z]+/g) ?? []) {
    if (EN_WORDS.has(word)) en++;
    else if (ES_WORDS.has(word)) es++;
  }
  if (en + es < MIN_HITS) return null;
  if (en >= es * MIN_RATIO) return "en";
  if (es >= en * MIN_RATIO) return "es";
  return null;
}

export function detectEnglish(jdText: string | null, lang: string | null): EnglishDetection {
  const folded = jdText ? foldText(jdText.slice(0, MAX_JD_CHARS)) : "";
  const language = detectLanguage(folded, lang);
  let asks = false;
  let best = -1;
  // El ámbito de una mención es su oración o ítem de lista, no una ventana de caracteres.
  // Un texto sin separadores se parte en trozos para que el costo no crezca con el largo.
  const fragments = folded
    .split(/\n|[.;•]|\s-\s/)
    .flatMap((f) => (f.length <= MAX_FRAGMENT_CHARS ? [f] : chunks(f, MAX_FRAGMENT_CHARS)));
  for (const fragment of fragments) {
    const mentions = spansOf(fragment, ENGLISH_WORD).filter(
      (s) =>
        !NOT_A_REQUIREMENT.test(
          fragment.slice(Math.max(0, s.start - EXCLUDE_WINDOW), s.end + EXCLUDE_WINDOW),
        ),
    );
    if (!mentions.length) continue;
    const level = fragmentLevel(fragment, mentions);
    if (level < 0 && !CONTEXT.test(fragment)) continue;
    asks = true;
    best = Math.max(best, level);
  }
  return { language, asks, level: best >= 0 ? (LEVEL_ORDER[best] ?? null) : null };
}
