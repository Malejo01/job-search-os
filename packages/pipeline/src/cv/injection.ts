import { detectEvaluatorInjection } from "../evaluator/injection";
import { foldText } from "../normalize/text";

/** Patrones propios del CV sobre texto plegado (minúsculas, sin acentos). */
const CV_PATTERNS: readonly { name: string; re: RegExp }[] = [
  { name: "cv_marca_apertura", re: /<<<\s*(?:fin\s+)?cv\b/ },
  { name: "cv_marca_cierre", re: /\b(?:fin\s+)?cv\s*>>>/ },
  { name: "nivel_en_todas", re: /\bnivel\s*[123]\s+en\s+(?:todas|todos|todo)\b/ },
  { name: "poner_nivel", re: /\bpon(?:e|ele|er)?\s+(?:el\s+)?nivel\s*[123]\b/ },
  { name: "maximo_nivel_en_todo", re: /\bmaximo\s+nivel\s+en\s+(?:todo|todas|todos)\b/ },
  { name: "set_all_skills", re: /\bset\s+all\s+(?:my\s+|the\s+)?skills\b/ },
  { name: "level_in_all", re: /\blevel\s*[123]\s+(?:in|on|for)\s+all\b/ },
  { name: "all_skills_level", re: /\ball\s+(?:my\s+)?skills\s+(?:to\s+|at\s+)?(?:level|max)/ },
];

/** Invisibles que partirían una frase para esquivar los patrones. */
const INVISIBLE_RE = new RegExp(
  "[\\u00ad\\u200b-\\u200f\\u202a-\\u202e\\u2060-\\u2064\\u2066-\\u2069\\ufeff]|[\\u{e0000}-\\u{e007f}]",
  "gu",
);
const BIDI_RE = new RegExp("[\\u200e\\u200f\\u202a-\\u202e\\u2066-\\u2069]", "g");

/**
 * Los patrones de `detectEvaluatorInjection` más los del CV. Devuelve solo NOMBRES de señales,
 * nunca el texto: el CV es contenido de terceros.
 */
export function detectCvInjection(text: string): { hit: boolean; signals: string[] } {
  // El base ya limpia sus invisibles (y marca los de etiqueta); acá se le quitan además los bidi
  const base = detectEvaluatorInjection(text.replace(BIDI_RE, ""));
  const folded = foldText(text.replace(INVISIBLE_RE, ""));
  const own = CV_PATTERNS.filter((p) => p.re.test(folded)).map((p) => p.name);
  const signals = [...base.signals, ...own];
  return { hit: signals.length > 0, signals };
}
