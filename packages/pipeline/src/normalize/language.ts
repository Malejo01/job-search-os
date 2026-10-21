import { MAX_JD_CHARS } from "../pool/career/english";
import { foldText } from "./text";

/**
 * Idioma en el que está escrito un aviso (ronda 101). Determinista y conservador, sin LLM.
 * Distinto de `detectEnglish(...).language`, que el prefiltro usa y solo conoce en/es: acá también
 * portugués, y un texto sin evidencia suficiente da `null` en vez de adivinar.
 */
export type DetectedJobLanguage = "es" | "en" | "pt";
type JobLanguage = DetectedJobLanguage;

// Palabras que distinguen: se dejan afuera las que comparten es y pt ("de", "que", "para", "por",
// "se", "no") y las que en inglés son comunes ("a", "as", "do", "me").
const WORDS: Record<JobLanguage, ReadonlySet<string>> = {
  en: new Set([
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
  ]),
  es: new Set([
    "el",
    "la",
    "los",
    "las",
    "del",
    "y",
    "con",
    "en",
    "es",
    "un",
    "una",
    "tu",
    "nuestro",
    "nuestra",
    "somos",
    "buscamos",
    "trabajo",
    "equipo",
  ]),
  pt: new Set([
    "nao",
    "voce",
    "voces",
    "vaga",
    "uma",
    "um",
    "com",
    "em",
    "os",
    "das",
    "ou",
    "seu",
    "sua",
    "nosso",
    "nossa",
    "trabalho",
    "equipe",
    "sao",
    "mais",
    "ao",
    "pelo",
    "pela",
    "tambem",
  ]),
};

// "trabalho" y "equipe" son pt; "trabajo" y "equipo" son es: no se solapan tras foldText.
const MIN_HITS = 8;
const MIN_RATIO = 2;

function fromSource(sourceLang: string | null): JobLanguage | null {
  const code = sourceLang?.trim().toLowerCase().slice(0, 2);
  return code === "es" || code === "en" || code === "pt" ? code : null;
}

/**
 * `sourceLang` manda si es es/en/pt (la fuente lo declara); si no, se cuentan palabras frecuentes.
 * Sin mínimo de aciertos o con el primero a menos del doble del segundo: `null`.
 */
export function detectJobLanguage(
  jdText: string | null,
  sourceLang: string | null,
): JobLanguage | null {
  const declared = fromSource(sourceLang);
  if (declared) return declared;
  if (!jdText) return null;
  const counts: Record<JobLanguage, number> = { en: 0, es: 0, pt: 0 };
  for (const word of foldText(jdText.slice(0, MAX_JD_CHARS)).match(/[a-z]+/g) ?? []) {
    if (WORDS.en.has(word)) counts.en++;
    if (WORDS.es.has(word)) counts.es++;
    if (WORDS.pt.has(word)) counts.pt++;
  }
  const ranked = (Object.entries(counts) as [JobLanguage, number][]).sort((a, b) => b[1] - a[1]);
  const [top, second] = ranked;
  if (!top || !second || top[1] < MIN_HITS) return null;
  return top[1] >= second[1] * MIN_RATIO ? top[0] : null;
}
