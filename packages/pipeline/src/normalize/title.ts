import { foldText, squash, stripBrackets } from "./text";

/** Niveles de seniority: no cambian el rol, solo el nivel. Se quitan para comparar títulos. */
const SENIORITY = new Set([
  "junior",
  "jr",
  "semi",
  "semisenior",
  "semisr",
  "ssr",
  "senior",
  "sr",
  "mid",
  "middle",
  "intermediate",
  "trainee",
  "entry",
  "i",
  "ii",
  "iii",
  "iv",
]);

/** Stopwords en español e inglés, más modalidad y región que no describen el rol. */
const STOPWORDS = new Set([
  "de",
  "del",
  "la",
  "el",
  "los",
  "las",
  "y",
  "e",
  "o",
  "u",
  "con",
  "para",
  "por",
  "en",
  "a",
  "un",
  "una",
  "and",
  "or",
  "of",
  "the",
  "for",
  "with",
  "in",
  "at",
  "to",
  "on",
  "remote",
  "remoto",
  "remota",
  "hybrid",
  "hibrido",
  "hibrida",
  "onsite",
  "presencial",
  "latam",
  "latinoamerica",
  "argentina",
]);

/** Variantes con puntuación o espacios que deben quedar como un solo token. */
const CANONICAL_TOKENS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bfull[\s-]?stack\b/g, "fullstack"],
  [/\bfront[\s-]?end\b/g, "frontend"],
  [/\bback[\s-]?end\b/g, "backend"],
  [/(?:^|[\s(/|,])\.net\b/g, " dotnet"],
  [/\bc#/g, "csharp"],
  [/\bc\+\+/g, "cpp"],
  [/\bnode\.js\b/g, "nodejs"],
  [/\bnext\.js\b/g, "nextjs"],
  [/\bvue\.js\b/g, "vuejs"],
  [/\breact\.js\b/g, "reactjs"],
];

/** Ids de aviso pegados al título ("ID87374"), números sueltos. */
const NOISE_TOKEN = /^(?:id\d+|\d+)$/;

/**
 * Tokens normalizados de un título: minúsculas sin diacríticos, sin paréntesis,
 * sin seniority ni stopwords, únicos y en orden de aparición. Insumo del Jaccard de dedup.
 */
export function titleTokens(raw: string): string[] {
  let text = foldText(stripBrackets(raw));
  for (const [pattern, replacement] of CANONICAL_TOKENS) text = text.replace(pattern, replacement);
  text = text.replace(/[^a-z0-9]+/g, " ");

  const seen = new Set<string>();
  for (const token of squash(text).split(" ")) {
    if (!token || SENIORITY.has(token) || STOPWORDS.has(token) || NOISE_TOKEN.test(token)) continue;
    seen.add(token);
  }
  return [...seen];
}

/** Título normalizado como string (tokens unidos por espacio). Se guarda en `jobs.title_normalized`. */
export function normalizeTitle(raw: string): string {
  return titleTokens(raw).join(" ");
}
