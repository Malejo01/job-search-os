/**
 * Palabras clave de la carrera, por código (R20-01). Puro: compara los términos del CV con las skills más
 * pedidas del mercado del puesto principal y devuelve cuántas cubre, sin modelo ni red. El mercado llega ya
 * leído (`getRoleMarket`); acá no hay I/O ni fecha.
 *
 * Reglas, todas deterministas:
 * - Se miran las 15 skills más pedidas (por menciones; desempata el nombre). Sin repetidas.
 * - Con menos de 20 avisos en el puesto, o sin skills, no hay puntaje: `no_data` (no se inventa).
 * - Puntaje 0 a 10 = skills cubiertas / skills miradas. Si el mercado trae pocas skills, el denominador
 *   tiene piso (`CV_KEYWORDS_FLOOR_DENOMINATOR`): cubrir 2 de 2 no da 10.
 * - Normalización simple: minúsculas, sin acentos, todo signo es separador, y «c++», «c#» y «.net» se
 *   conservan como términos propios. Una skill cuenta si su nombre o su slug aparece como palabra entera, o
 *   pegado sin espacios («node.js» = «nodejs» = «node js»). No hay sinónimos más allá de eso.
 * - El consejo son las 5 que faltan, en orden de demanda.
 * Entrada acotada: el texto se recorta a `MAX_TOTAL_CHARS`.
 */

/** Avisos mínimos del puesto para opinar. */
export const CV_KEYWORDS_MIN_JOBS = 20;
/** Cuántas skills del mercado se miran. */
export const CV_KEYWORDS_TOP = 15;
/** Piso del denominador cuando el mercado trae menos skills que `CV_KEYWORDS_TOP`. */
export const CV_KEYWORDS_FLOOR_DENOMINATOR = 8;
/** Cuántas faltantes se aconsejan. */
export const CV_KEYWORDS_ADVICE_MAX = 5;

const MAX_TOTAL_CHARS = 200_000;
const MAX_MARKET_SKILLS = 200;

export type KeywordMarketSkill = { slug: string; name: string; mentions: number };
export type KeywordMarket = { jobs: number; skills: readonly KeywordMarketSkill[] };

export type CvKeywordsResult =
  | { status: "no_data"; jobs: number }
  | {
      status: "scored";
      /** 0 a 10, un decimal. */
      score: number;
      /** Nombres de las skills cubiertas, en orden de demanda. */
      covered: string[];
      /** Hasta 5 skills que faltan, en orden de demanda. */
      missing: string[];
      /** Skills del mercado que se miraron (hasta 15). */
      considered: number;
    };

/** Minúsculas, sin acentos, signos como separador; conserva c++, c# y .net. */
export function normalizeKeywordText(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/c\+\+/g, "cplusplus")
    .replace(/([a-z])#/g, "$1sharp")
    .replace(/(^|[^a-z0-9])\.net(?![a-z0-9])/g, "$1dotnet")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Formas en que una skill puede aparecer escrita (sin repetir). */
function variantsOf(skill: KeywordMarketSkill): string[] {
  const out = new Set<string>();
  for (const base of [normalizeKeywordText(skill.name), normalizeKeywordText(skill.slug)]) {
    if (base === "") continue;
    out.add(base);
    if (base.includes(" ")) out.add(base.replace(/ /g, ""));
  }
  return [...out];
}

export function analyzeCvKeywords(
  texts: readonly string[],
  market: KeywordMarket,
): CvKeywordsResult {
  // Ordena por demanda (no confía en el orden de entrada), saca repetidas y toma las 15 primeras
  const seen = new Set<string>();
  const top = [...market.skills]
    .slice(0, MAX_MARKET_SKILLS)
    .sort((a, b) => b.mentions - a.mentions || a.slug.localeCompare(b.slug))
    .filter((s) => (seen.has(s.slug) ? false : (seen.add(s.slug), true)))
    .slice(0, CV_KEYWORDS_TOP);
  if (market.jobs < CV_KEYWORDS_MIN_JOBS || top.length === 0) {
    return { status: "no_data", jobs: market.jobs };
  }

  let budget = MAX_TOTAL_CHARS;
  const parts: string[] = [];
  for (const t of texts) {
    if (budget <= 0) break;
    const piece = t.slice(0, budget);
    budget -= piece.length;
    parts.push(piece);
  }
  const haystack = ` ${normalizeKeywordText(parts.join("\n"))} `;

  const covered: string[] = [];
  const missing: string[] = [];
  for (const skill of top) {
    const hit = variantsOf(skill).some((v) => haystack.includes(` ${v} `));
    if (hit) covered.push(skill.name);
    else missing.push(skill.name);
  }
  const denominator = Math.max(top.length, CV_KEYWORDS_FLOOR_DENOMINATOR);
  return {
    status: "scored",
    score: Math.round((covered.length / denominator) * 100) / 10,
    covered,
    missing: missing.slice(0, CV_KEYWORDS_ADVICE_MAX),
    considered: top.length,
  };
}
