/**
 * Normalización determinista de menciones de skills (adelanto de JS-030 sin LLM).
 * Entrada: el campo `stack` de una oferta (strings libres como "Python (Django/Flask/FastAPI)",
 * "Docker/K8s", "Vertex/LangChain deseable"). Salida: skills de la taxonomía (`skills` con
 * aliases) con `isMust`, más lo que no se pudo mapear, para que se vea y no se pierda en silencio.
 *
 * Regla: un término de la taxonomía (slug, nombre o alias) cuenta si aparece como palabra entera
 * dentro de la mención. Se prueban los términos más largos primero y se tapa el tramo matcheado,
 * así "react native" no suma también "react". Nada de similitud por letras: o está o no está.
 */
export type SkillTaxonomyEntry = { slug: string; name: string; aliases: readonly string[] };

export type SkillMention = { slug: string; isMust: boolean; rawMention: string };

export type StackMatch = {
  mentions: SkillMention[];
  /** Tramos de las menciones que no matchearon ningún término (ya sin calificadores). */
  unmapped: string[];
};

/** Marcan que la mención es deseable, no requisito. */
const OPTIONAL_RE =
  /\b(deseable|deseables|nice to have|nice|plus|opcional|preferible|preferred|bonus)\b/i;
/** Marcan requisito explícito (ya es el default; se detectan solo para limpiar el texto). */
const MUST_RE = /\(must\)|\bmust\b|excluyente|requerido|required/gi;
/** Calificadores que no son skills: años, niveles, etc. */
const QUALIFIER_RE =
  /\d+\+?\s*(años|anos|years|yrs)\b|\b(avanzado|experto|expert|básico|basico|profundo|senior|junior|sólido|solido|fuerte|productivo|intermedio)\b/gi;

export function normalizeMention(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[“”"'`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

export type Term = { slug: string; term: string; re: RegExp };

/** Compila la taxonomía una vez: todos los términos, más largos primero. */
export function compileTaxonomy(taxonomy: readonly SkillTaxonomyEntry[]): Term[] {
  const terms: Term[] = [];
  for (const entry of taxonomy) {
    const candidates = new Set<string>([
      entry.slug.replace(/_/g, " "),
      entry.name,
      ...entry.aliases,
    ]);
    for (const c of candidates) {
      const term = normalizeMention(c);
      if (term.length < 2) continue;
      // Palabra entera: sin letra/número pegado a los lados (permite "c#", ".net", "node.js")
      terms.push({
        slug: entry.slug,
        term,
        re: new RegExp(`(^|[^a-z0-9])(${escapeRe(term)})(?=[^a-z0-9]|$)`, "i"),
      });
    }
  }
  return terms.sort((a, b) => b.term.length - a.term.length);
}

/** Skills mencionadas en UNA entrada del stack. */
export function matchMention(
  raw: string,
  terms: readonly Term[],
): { slugs: string[]; isMust: boolean; leftover: string[] } {
  const isMust = !OPTIONAL_RE.test(raw);
  let text = normalizeMention(raw)
    .replace(OPTIONAL_RE, " ")
    .replace(MUST_RE, " ")
    .replace(QUALIFIER_RE, " ");
  const slugs: string[] = [];
  for (const t of terms) {
    const m = t.re.exec(text);
    if (!m) continue;
    if (!slugs.includes(t.slug)) slugs.push(t.slug);
    // Tapar el tramo para que un término más corto de OTRA skill no lo vuelva a contar
    const start = m.index + m[1]!.length;
    text = text.slice(0, start) + " ".repeat(m[2]!.length) + text.slice(start + m[2]!.length);
  }
  const leftover = text
    .split(/[/,;()+&]| o | y | and | or |\bcon\b|\bvia\b|\bvía\b/)
    .map((s) =>
      s
        .replace(/[^a-z0-9#.\s-]/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter((s) => /[a-z]{3,}/.test(s));
  return { slugs, isMust, leftover };
}

/** Skills de una oferta a partir de su `stack`; una skill mencionada como must y como deseable queda must. */
export function matchStack(
  stack: readonly string[],
  taxonomy: readonly SkillTaxonomyEntry[] | readonly Term[],
): StackMatch {
  const terms: readonly Term[] =
    taxonomy.length && "re" in taxonomy[0]!
      ? (taxonomy as readonly Term[])
      : compileTaxonomy(taxonomy as readonly SkillTaxonomyEntry[]);
  const bySlug = new Map<string, SkillMention>();
  const unmapped: string[] = [];
  for (const raw of stack) {
    const { slugs, isMust, leftover } = matchMention(raw, terms);
    for (const slug of slugs) {
      const prev = bySlug.get(slug);
      if (!prev) bySlug.set(slug, { slug, isMust, rawMention: raw });
      else if (isMust && !prev.isMust) bySlug.set(slug, { ...prev, isMust: true });
    }
    unmapped.push(...leftover);
  }
  return { mentions: [...bySlug.values()], unmapped };
}

/**
 * Skills mencionadas en un texto largo (JD completa), por término entero, más largos primero y
 * tapando el tramo matcheado (igual que matchMention). No distingue must/deseable: en una JD la
 * posición no alcanza para saberlo sin LLM, así que se devuelven como menciones.
 */
export function extractSkillsFromText(
  text: string,
  taxonomy: readonly SkillTaxonomyEntry[] | readonly Term[],
): string[] {
  const terms: readonly Term[] =
    taxonomy.length && "re" in taxonomy[0]!
      ? (taxonomy as readonly Term[])
      : compileTaxonomy(taxonomy as readonly SkillTaxonomyEntry[]);
  let body = normalizeMention(text);
  const slugs: string[] = [];
  for (const t of terms) {
    const global = new RegExp(t.re.source, "gi");
    let m: RegExpExecArray | null;
    let hit = false;
    while ((m = global.exec(body)) !== null) {
      hit = true;
      const start = m.index + m[1]!.length;
      body = body.slice(0, start) + " ".repeat(m[2]!.length) + body.slice(start + m[2]!.length);
      global.lastIndex = start + m[2]!.length;
    }
    if (hit && !slugs.includes(t.slug)) slugs.push(t.slug);
  }
  return slugs;
}
