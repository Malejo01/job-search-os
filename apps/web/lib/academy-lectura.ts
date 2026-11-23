/**
 * Academy, lectura cómoda (R23-03): lógica pura, sin I/O ni `node:fs`, para poder usarla también en el
 * buscador del cliente sin arrastrar el lector de fichas.
 */

export type FichaItem = { slug: string; titulo: string; bajada: string };

/** Minúsculas, sin acentos (ni diéresis) y sin espacios de los bordes. */
export function normalizeSearch(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

/** Fichas cuyo título o bajada contienen todas las palabras de la consulta. Sin consulta, todas. */
export function searchFichas<T extends { titulo: string; bajada: string }>(
  items: readonly T[],
  query: string,
): T[] {
  const words = normalizeSearch(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...items];
  return items.filter((i) => {
    const hay = normalizeSearch(`${i.titulo} ${i.bajada}`);
    return words.every((w) => hay.includes(w));
  });
}

const WORDS_PER_MINUTE = 200;

/** Minutos de lectura estimados: redondeo hacia arriba, nunca menos de uno. */
export function readingMinutes(words: number): number {
  if (!Number.isFinite(words) || words <= 0) return 1;
  return Math.max(1, Math.ceil(words / WORDS_PER_MINUTE));
}

/** Fichas hermanas por tema, curadas a mano (los slugs son los de `content/academy`). */
const RELACIONADAS: Readonly<Record<string, readonly string[]>> = {
  "filtro-ats": ["palabras-clave", "carta-de-presentacion", "linkedin"],
  "palabras-clave": ["filtro-ats", "afinidad", "carta-de-presentacion"],
  "carta-de-presentacion": ["palabras-clave", "metodo-star", "filtro-ats"],
  "metodo-star": [
    "carta-de-presentacion",
    "despues-de-postularte",
    "primer-empleo-sin-experiencia",
  ],
  afinidad: ["transparencia-del-aviso", "seniority", "palabras-clave"],
  "transparencia-del-aviso": ["afinidad", "rango-salarial", "presencial-hibrido-remoto"],
  "rango-salarial": ["transparencia-del-aviso", "dependencia-y-monotributo", "seniority"],
  "dependencia-y-monotributo": [
    "rango-salarial",
    "presencial-hibrido-remoto",
    "transparencia-del-aviso",
  ],
  "presencial-hibrido-remoto": ["transparencia-del-aviso", "nivel-de-ingles", "rango-salarial"],
  "nivel-de-ingles": ["presencial-hibrido-remoto", "afinidad", "linkedin"],
  seniority: ["afinidad", "primer-empleo-sin-experiencia", "pasantias"],
  "primer-empleo-sin-experiencia": ["pasantias", "referencias-laborales", "metodo-star"],
  pasantias: ["primer-empleo-sin-experiencia", "seniority", "referencias-laborales"],
  "referencias-laborales": ["despues-de-postularte", "linkedin", "primer-empleo-sin-experiencia"],
  "despues-de-postularte": ["metodo-star", "referencias-laborales", "carta-de-presentacion"],
  linkedin: ["palabras-clave", "referencias-laborales", "filtro-ats"],
};

const MAX_RELACIONADAS = 3;

/** Slugs relacionados con `slug` que están publicados (`disponibles`), sin la propia, hasta tres. */
export function fichaRelacionadas(slug: string, disponibles: readonly string[]): string[] {
  const candidatas = Object.hasOwn(RELACIONADAS, slug) ? RELACIONADAS[slug]! : [];
  return candidatas.filter((s) => s !== slug && disponibles.includes(s)).slice(0, MAX_RELACIONADAS);
}

/** Pantallas desde las que se puede llegar a una ficha (`?desde=`). Lista cerrada. */
export const ACADEMY_ORIGENES = ["interview", "cv", "avisos", "postulacion", "perfil"] as const;
export type AcademyOrigen = (typeof ACADEMY_ORIGENES)[number];

/** El valor del query `desde`, validado contra la lista cerrada; cualquier otra cosa es `null`. */
export function parseOrigen(value: string | string[] | undefined): AcademyOrigen | null {
  if (typeof value !== "string") return null;
  return (ACADEMY_ORIGENES as readonly string[]).includes(value) ? (value as AcademyOrigen) : null;
}

const POR_ORIGEN: Readonly<Record<AcademyOrigen, readonly string[]>> = {
  interview: ["metodo-star"],
  cv: ["filtro-ats", "palabras-clave"],
  avisos: ["transparencia-del-aviso", "afinidad"],
  postulacion: ["despues-de-postularte", "carta-de-presentacion"],
  perfil: ["seniority", "nivel-de-ingles"],
};

/** «Te puede servir» según la pantalla de origen: solo fichas publicadas y distintas de la actual. */
export function recomendadasPorOrigen(
  origen: AcademyOrigen | null,
  disponibles: readonly string[],
  actual?: string,
): string[] {
  if (!origen) return [];
  return POR_ORIGEN[origen].filter((s) => s !== actual && disponibles.includes(s));
}
