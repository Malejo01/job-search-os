import {
  compileTaxonomy,
  extractSkillsFromText,
  normalizeMention,
  type SkillTaxonomyEntry,
  type Term,
} from "./match";

/**
 * Candidatos a skill nueva, sin LLM (JS-030). Dado el texto de varias JD y la taxonomía, devuelve
 * los términos de aspecto técnico que la taxonomía NO reconoce, con su frecuencia. Es una lista de
 * propuestas para que una persona las mire: no cambia la demanda ni la taxonomía.
 *
 * "Aspecto técnico" = siglas (RAG), mayúscula interna (GraphQL, OAuth), sufijos .js/.net/#/++,
 * letras con número (GPT-4, Llama3) y siglas en minúscula sin vocales (dbt, npm). Los bigramas son
 * dos términos técnicos desconocidos pegados por un solo espacio (LangGraph PyTorch).
 *
 * Primero se descubren los términos por su aspecto; después se cuentan todas sus apariciones sin
 * distinguir mayúsculas ("graphql" suma a "GraphQL"). Puro y determinista: el orden de los textos
 * no cambia el resultado. Los `examples` son variantes de escritura del término, nunca texto del aviso.
 */
export type SkillCandidate = { term: string; count: number; examples?: string[] };

export type SkillCandidateOptions = {
  /** Apariciones mínimas (suma entre todos los textos). Default 2. */
  minCount?: number;
  /** Máximo de candidatos devueltos. Default: todos. */
  limit?: number;
  /** Variantes de escritura que se informan por candidato. Default 3. */
  maxExamples?: number;
  /**
   * Términos a excluir, sin distinguir mayúsculas ni acentos. Se descarta el candidato igual a uno
   * de ellos, parte de uno ("Acme" si se excluye "Acme Labs") o que lo contiene ("Acme Labs" si se
   * excluye "Acme"). Quien llama DEBE pasar los nombres de empresa de las ofertas (`companyRaw`):
   * sus nombres propios se parecen a una tecnología (mayúscula interna, siglas) y no deben
   * aparecer como candidatos.
   */
  exclude?: readonly string[];
};

/** Palabras normalizadas (minúscula, sin acentos) de un nombre o clave. */
const wordsOf = (s: string): string[] =>
  normalizeMention(s)
    .split(/[^a-z0-9.#+_-]+/)
    .filter((w) => w.length > 0);

/** `needle` aparece como tramo contiguo de palabras dentro de `hay`. */
function containsRun(hay: readonly string[], needle: readonly string[]): boolean {
  if (needle.length === 0 || needle.length > hay.length) return false;
  for (let i = 0; i + needle.length <= hay.length; i++) {
    if (needle.every((w, k) => hay[i + k] === w)) return true;
  }
  return false;
}

/** Palabras comunes (es/en) y de avisos de empleo: nunca son candidatas. Claves en minúscula. */
const STOPWORDS = new Set([
  ...["the", "and", "for", "with", "you", "our", "are", "not", "but", "all", "any", "can", "per"],
  ...["una", "uno", "los", "las", "del", "con", "por", "para", "que", "sin", "sus", "mas", "muy"],
  ...["experiencia", "experience", "remote", "remoto", "team", "equipo", "senior", "junior"],
  ...["job", "jobs", "work", "trabajo", "years", "anos", "role", "rol", "plus", "bonus"],
  ...["why", "try", "nth", "hmm", "shh"],
  // Siglas y marcas que no son skills
  ...["ceo", "cto", "cfo", "coo", "vp", "hr", "usa", "eu", "uk", "ok", "pm", "am", "vs", "faq"],
  ...["cv", "asap", "tbd", "eta", "pdf", "iphone", "linkedin", "youtube", "whatsapp", "glassdoor"],
  ...["q1", "q2", "q3", "q4", "h1", "h2", "usd", "eur", "ars", "gmt", "utc", "etc", "fyi", "kpi"],
  ...["okr", "okrs", "cc", "dm", "ft", "pt", "id", "ip", "it", "tv", "ui", "ux"],
  // Palabras comunes que se cuelan por mayúscula de inicio de oración o por títulos en mayúsculas
  ...["ser", "son", "esta", "este", "como", "todo", "desde", "hasta", "entre", "sobre", "nuestro"],
  ...["requisitos", "beneficios", "ofrecemos", "buscamos", "responsabilidades", "about", "skills"],
  ...["requirements", "benefits", "offer", "looking", "must", "have", "will", "your", "from"],
]);

/** Tecnologías de 2 caracteres que sí se aceptan; el resto de los términos necesita 3 o más. */
const SHORT_TECH = new Set(["go", "r", "c#", "f#", "s3", "d3", "qt"]);

// Letras Unicode: "Inglés" es una sola palabra, no "Ingl" + "s"
const TOKEN_RE = /\.?[\p{L}\p{N}][\p{L}\p{N}.#+_-]*/gu;

type Token = { surface: string; key: string; start: number; end: number; technical: boolean };

function looksTechnical(surface: string): boolean {
  return (
    /^[A-Z]{2,6}$/.test(surface) || // RAG, SQL
    /[a-z][A-Z]/.test(surface) || // GraphQL, PyTorch
    /^[A-Z]{2,}[a-z]/.test(surface) || // OAuth
    /^[A-Za-z]+(#|\+\+)$/.test(surface) || // C#, F#, Zeta++
    /^[A-Za-z]+\.(js|net|ts|py)$/i.test(surface) || // Next.js, ASP.NET
    /^\.net$/i.test(surface) ||
    /^[A-Za-z]+[-.]?\d+(\.\d+)*$/.test(surface) || // GPT-4, Llama3, S3
    /^[bcdfghjklmnpqrstvwxz]{3,5}$/.test(surface) // dbt, npm, pnpm
  );
}

const MAX_TERM_LENGTH = 30;

/** IDs y tokens de tracking: demasiado largos, o letras y dígitos mezclados de 13+ sin separador técnico. */
function looksLikeId(surface: string): boolean {
  if (surface.length > MAX_TERM_LENGTH) return true;
  return /^[A-Za-z0-9]{13,}$/.test(surface) && /[A-Za-z]/.test(surface) && /\d/.test(surface);
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  for (const m of text.matchAll(TOKEN_RE)) {
    let surface = m[0].replace(/[.\-_]+$/, "");
    if (surface.startsWith(".") && !/^\.net$/i.test(surface)) surface = surface.slice(1);
    if (surface.length < 2) continue;
    // Plural de sigla: "LLMs" cuenta como "LLM"
    if (/^[A-Z]{2,6}s$/.test(surface)) surface = surface.slice(0, -1);
    const key = surface.toLowerCase();
    const start = m.index ?? 0;
    tokens.push({
      surface,
      key,
      start,
      end: start + m[0].length,
      technical:
        !STOPWORDS.has(key) &&
        /\p{L}/u.test(surface) &&
        !looksLikeId(surface) &&
        (key.length >= 3 || SHORT_TECH.has(key)) &&
        looksTechnical(surface),
    });
  }
  return tokens;
}

type Tally = { count: number; surfaces: Map<string, number> };

function bump(tally: Map<string, Tally>, key: string, surface: string): void {
  const entry = tally.get(key) ?? { count: 0, surfaces: new Map<string, number>() };
  entry.count += 1;
  entry.surfaces.set(surface, (entry.surfaces.get(surface) ?? 0) + 1);
  tally.set(key, entry);
}

export function skillCandidates(
  texts: readonly string[],
  taxonomy: readonly SkillTaxonomyEntry[] | readonly Term[],
  options: SkillCandidateOptions = {},
): SkillCandidate[] {
  const { minCount = 2, limit, maxExamples = 3, exclude = [] } = options;
  const terms: readonly Term[] =
    taxonomy.length && "re" in taxonomy[0]!
      ? (taxonomy as readonly Term[])
      : compileTaxonomy(taxonomy as readonly SkillTaxonomyEntry[]);

  // "Ya matchea" = lo mismo que haría extractSkillsFromText sobre el término suelto
  const knownCache = new Map<string, boolean>();
  const isKnown = (surface: string): boolean => {
    const cached = knownCache.get(surface);
    if (cached !== undefined) return cached;
    const known = extractSkillsFromText(surface, terms).length > 0;
    knownCache.set(surface, known);
    return known;
  };

  const tokenized = texts.map(tokenize);

  // Paso 1: términos descubiertos por su aspecto técnico y desconocidos para la taxonomía
  const discovered = new Set<string>();
  for (const tokens of tokenized) {
    for (const t of tokens) if (t.technical && !isKnown(t.surface)) discovered.add(t.key);
  }

  // Paso 2: contar todas las apariciones de esos términos (cualquier capitalización) y sus bigramas
  const tally = new Map<string, Tally>();
  tokenized.forEach((tokens, i) => {
    const text = texts[i]!;
    tokens.forEach((t, j) => {
      if (!discovered.has(t.key)) return;
      bump(tally, t.key, t.surface);
      const next = tokens[j + 1];
      if (next && discovered.has(next.key) && text.slice(t.end, next.start) === " ") {
        bump(tally, `${t.key} ${next.key}`, `${t.surface} ${next.surface}`);
      }
    });
  });

  const excluded = exclude.map(wordsOf).filter((w) => w.length > 0);

  const out: SkillCandidate[] = [];
  for (const [key, { count, surfaces }] of tally) {
    if (count < minCount) continue;
    const words = wordsOf(key);
    if (excluded.some((e) => containsRun(e, words) || containsRun(words, e))) continue;
    const examples = [...surfaces.entries()]
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .map(([surface]) => surface);
    const candidate: SkillCandidate = { term: examples[0]!, count };
    if (examples.length > 1) candidate.examples = examples.slice(0, maxExamples);
    out.push(candidate);
  }
  out.sort((a, b) => b.count - a.count || (a.term < b.term ? -1 : a.term > b.term ? 1 : 0));
  return limit === undefined ? out : out.slice(0, limit);
}
