/**
 * Diagnóstico del CV por ítems. Puro: recibe el CV ya armado (`CvDocument`) y devuelve, por código, un
 * puntaje de 0 a 10, un nivel y un consejo concreto para estructura, secciones y legibilidad (con el largo).
 * Palabras clave de la carrera salen del mercado del puesto (`cv-keywords.ts`, por código): sin mercado
 * quedan en `soon`; con menos de 20 avisos, en `no_data`. Logros medibles también salen por código
 * (`cv-measurable.ts`): cuántas viñetas de experiencia, proyectos y logros traen un resultado. El nivel es
 * un código; las palabras que ve la persona las pone la web. Entrada acotada: ningún campo ni cantidad crece sin tope.
 */
import type { CvDocument, CvSection, CvSectionId } from "./cv-out/model";
import { analyzeCvKeywords, type KeywordMarket } from "./cv-keywords";
import { analyzeCvMeasurable } from "./cv-measurable";

export const CV_DIAGNOSIS_ITEM_IDS = [
  "structure",
  "keywords",
  "readability",
  "length",
  "achievements",
  "sections",
] as const;
export type CvDiagnosisItemId = (typeof CV_DIAGNOSIS_ITEM_IDS)[number];

/**
 * Nivel de un puntaje entero (R33-06, C-36): `good` = «Sólido» (8 a 10), `improvable` = «En camino» (5 a 7),
 * `missing` = «Para reforzar» (1 a 4) y `empty` = «Sin empezar» (0). Las palabras las pone la web.
 */
export type CvDiagnosisLevel = "good" | "improvable" | "missing" | "empty";

/**
 * Paso concreto de una «falta» (tabla 8.2 del informe). Es un código: la web decide el botón y a qué
 * campo exacto lleva.
 */
export type CvDiagnosisFix =
  | "add_headline"
  | "add_contact"
  | "add_summary"
  | "add_experience"
  | "add_education"
  | "add_skills"
  | "add_languages"
  | "mark_keywords"
  | "write_achievement"
  | "edit_history";

export type CvDiagnosisItem =
  | {
      id: CvDiagnosisItemId;
      status: "scored";
      /** Entero de 0 a 10. */
      score: number;
      level: CvDiagnosisLevel;
      advice: string;
      /** Pasos concretos, del más importante al menos. Vacío si no hace falta nada. */
      fixes: CvDiagnosisFix[];
    }
  | { id: CvDiagnosisItemId; status: "soon"; score: null; level: null; advice: null }
  /** Hay mercado pero con muy pocos avisos del puesto: no se inventa puntaje («Sin datos suficientes»). */
  | { id: CvDiagnosisItemId; status: "no_data"; score: null; level: null; advice: null }
  /**
   * Depende de algo que todavía no está cargado (C-40): sin experiencia no se mide la legibilidad, el largo
   * ni los logros. En vez de tres «Falta», una acción principal y el resto en pausa.
   */
  | {
      id: CvDiagnosisItemId;
      status: "waiting";
      score: null;
      level: null;
      advice: null;
      needs: "experience";
    };

export type CvDiagnosisOptions = {
  /**
   * Mercado del puesto principal (`getRoleMarket`, 15 skills o más). Sin él (`undefined` o `null`) las
   * palabras clave quedan en «Pronto»; con menos de 20 avisos, en «Sin datos suficientes».
   */
  keywords?: KeywordMarket | null;
};

/** Topes de lo que se mira: un CV de 2 MB se recorta, no se procesa entero. */
const MAX_SECTIONS = 20;
const MAX_BLOCKS = 40;
const MAX_BULLETS = 30;
const MAX_FIELD_CHARS = 1_000;
const MAX_TOTAL_CHARS = 200_000;

/** Umbrales de nivel, sobre el puntaje entero que ve la persona. */
export const CV_DIAGNOSIS_GOOD_FROM = 8;
export const CV_DIAGNOSIS_IMPROVABLE_FROM = 5;

/** Viñetas legibles: entre estas palabras y con este máximo de caracteres. */
const BULLET_MIN_WORDS = 4;
const BULLET_MAX_WORDS = 30;
const BULLET_MAX_CHARS = 220;
/** Largo total del CV (en palabras) que se considera cómodo. */
const IDEAL_WORDS_MIN = 200;
const IDEAL_WORDS_MAX = 800;

const SECTION_ORDER: readonly CvSectionId[] = [
  "summary",
  "experience",
  "projects",
  "education",
  "certifications",
  "skills",
  "languages",
  "achievements",
];

/** Secciones donde se mide si las viñetas traen un resultado. */
const RESULT_SECTIONS: readonly CvSectionId[] = ["experience", "projects", "achievements"];

/** Entero de 0 a 10 (un puntaje no numérico cuenta como 0). */
const wholeScore = (n: number) =>
  Number.isFinite(n) ? Math.round(Math.min(10, Math.max(0, n))) : 0;

/**
 * Nivel de un puntaje. Se redondea primero: la palabra sale del entero que se muestra (4,5 → 5 «En camino»;
 * 0,4 → 0 «Sin empezar»), nunca de un decimal que la persona no ve.
 */
export function cvDiagnosisLevel(score: number): CvDiagnosisLevel {
  const n = wholeScore(score);
  if (n >= CV_DIAGNOSIS_GOOD_FROM) return "good";
  if (n >= CV_DIAGNOSIS_IMPROVABLE_FROM) return "improvable";
  return n === 0 ? "empty" : "missing";
}

/**
 * `hasContent`: hay algo cargado que medir y dio 0. «Sin empezar» dice «no hay nada cargado»; con contenido
 * sería mentira, así que el nivel es «Para reforzar» (el 0 se muestra tal cual).
 */
function scored(
  id: CvDiagnosisItemId,
  raw: number,
  advice: string,
  fixes: CvDiagnosisFix[] = [],
  hasContent = false,
): CvDiagnosisItem {
  const score = wholeScore(raw);
  const level = score === 0 && hasContent ? "missing" : cvDiagnosisLevel(score);
  return { id, status: "scored", score, level, advice, fixes };
}

const WAITING = (id: CvDiagnosisItemId): CvDiagnosisItem => ({
  id,
  status: "waiting",
  score: null,
  level: null,
  advice: null,
  needs: "experience",
});

/**
 * Si varias barras esperan por lo mismo (no hay experiencia cargada), una sola acción principal (C-40).
 * `null` si ninguna espera.
 */
export function cvDiagnosisMainFix(items: readonly CvDiagnosisItem[]): CvDiagnosisFix | null {
  return items.some((i) => i.status === "waiting") ? "add_experience" : null;
}

const clip = (s: string | null) => (s ?? "").slice(0, MAX_FIELD_CHARS);
const countWords = (s: string) => (s.trim() === "" ? 0 : s.trim().split(/\s+/).length);

/** Copia acotada del documento: lo único que miran los ítems. */
type Bounded = {
  hasName: boolean;
  hasHeadline: boolean;
  hasContact: boolean;
  sections: { id: CvSectionId; title: string; filled: boolean }[];
  bulletWords: number[];
  bulletChars: number[];
  totalWords: number;
  /** Textos del CV (titular, títulos, encabezados, detalles y viñetas) para las palabras clave. */
  texts: string[];
  /** Viñetas de experiencia, proyectos y logros: donde se espera un resultado medible. */
  resultBullets: string[];
  /** Hay experiencia (o proyectos, que valen igual para quien empieza) con algo escrito. */
  hasExperience: boolean;
};

function bound(doc: CvDocument): Bounded {
  let budget = MAX_TOTAL_CHARS;
  const take = (s: string) => {
    const t = s.slice(0, Math.max(0, budget));
    budget -= t.length;
    return t;
  };
  const out: Bounded = {
    hasName: doc.name.trim() !== "",
    hasHeadline: (doc.headline ?? "").trim() !== "",
    hasContact: doc.contact.slice(0, 10).some((c) => c.trim() !== ""),
    sections: [],
    bulletWords: [],
    bulletChars: [],
    totalWords: 0,
    texts: [take(clip(doc.headline))],
    resultBullets: [],
    hasExperience: false,
  };
  for (const sec of doc.sections.slice(0, MAX_SECTIONS) as CvSection[]) {
    let filled = false;
    for (const block of sec.blocks.slice(0, MAX_BLOCKS)) {
      const heading = take(clip(block.heading));
      const detail = take(clip(block.detail));
      if (heading.trim() !== "" || detail.trim() !== "") filled = true;
      out.totalWords += countWords(heading) + countWords(detail);
      out.texts.push(heading, detail);
      for (const raw of block.bullets.slice(0, MAX_BULLETS)) {
        const b = take(clip(raw));
        if (b.trim() === "") continue;
        out.texts.push(b);
        if (RESULT_SECTIONS.includes(sec.id)) out.resultBullets.push(b);
        filled = true;
        const w = countWords(b);
        out.bulletWords.push(w);
        out.bulletChars.push(b.length);
        out.totalWords += w;
      }
    }
    out.sections.push({ id: sec.id, title: sec.title, filled });
    if (filled && (sec.id === "experience" || sec.id === "projects")) out.hasExperience = true;
  }
  return out;
}

function structureItem(b: Bounded): CvDiagnosisItem {
  const present = b.sections.filter((s) => s.filled);
  const ids = present.map((s) => s.id);
  const rank = (id: CvSectionId) => SECTION_ORDER.indexOf(id);
  // orden estándar: el resumen abre y lo más reciente (experiencia, proyectos) va antes que los estudios
  const orderOk = ids.length > 0 && ids.every((id, i) => i === 0 || rank(ids[i - 1]!) <= rank(id));
  const noEmpty = b.sections.length > 0 && b.sections.every((s) => s.filled);

  let score = 0;
  const gaps: string[] = [];
  const fixes: CvDiagnosisFix[] = [];
  if (b.hasName) score += 2;
  else gaps.push("tu nombre arriba de todo");
  if (b.hasContact) score += 3;
  else {
    gaps.push("un dato de contacto (email o ciudad)");
    fixes.push("add_contact");
  }
  if (b.hasHeadline) score += 2;
  else {
    gaps.push("un titular con el puesto que buscás");
    fixes.push("add_headline");
  }
  if (orderOk) score += 1.5;
  else if (ids.length > 0) {
    gaps.push("el orden estándar: resumen, experiencia, estudios y skills");
    fixes.push("edit_history");
  }
  if (noEmpty) score += 1.5;
  else if (b.sections.length > 0) {
    gaps.push("completar o sacar las secciones vacías");
    if (!fixes.includes("edit_history")) fixes.push("edit_history");
  }

  const advice =
    gaps.length === 0
      ? "Tiene nombre, contacto, titular y un orden que cualquier sistema de selección lee sin problema."
      : `Sumá o corregí: ${gaps.join("; ")}.`;
  return scored("structure", score, advice, fixes);
}

/** Secciones que un CV profesional trae: cada una vale 2 puntos. */
const EXPECTED: { ids: readonly CvSectionId[]; label: string; fix: CvDiagnosisFix }[] = [
  { ids: ["summary"], label: "Resumen", fix: "add_summary" },
  { ids: ["experience", "projects"], label: "Experiencia (o proyectos)", fix: "add_experience" },
  { ids: ["education"], label: "Educación", fix: "add_education" },
  { ids: ["skills"], label: "Skills", fix: "add_skills" },
  { ids: ["languages"], label: "Idiomas", fix: "add_languages" },
];

function sectionsItem(b: Bounded): CvDiagnosisItem {
  const missing = EXPECTED.filter((e) => !b.sections.some((s) => s.filled && e.ids.includes(s.id)));
  const score = (EXPECTED.length - missing.length) * 2;
  const advice =
    missing.length === 0
      ? "Están todas las secciones que se esperan en un CV profesional."
      : `Te faltan: ${missing.map((m) => m.label).join(", ")}. Cargalas en tu historial o con el coach.`;
  return scored(
    "sections",
    score,
    advice,
    missing.map((m) => m.fix),
  );
}

/** Legibilidad: qué tan cortas y claras son las viñetas. El largo del CV se mide aparte (`lengthItem`). */
function readabilityItem(b: Bounded): CvDiagnosisItem {
  if (!b.hasExperience) return WAITING("readability");
  const total = b.bulletWords.length;
  const good = b.bulletWords.filter(
    (w, i) =>
      w >= BULLET_MIN_WORDS && w <= BULLET_MAX_WORDS && b.bulletChars[i]! <= BULLET_MAX_CHARS,
  ).length;
  const score = total === 0 ? 0 : (good / total) * 10;
  let advice = "Viñetas cortas, de una idea por línea.";
  let fixes: CvDiagnosisFix[] = [];
  if (total === 0) {
    advice = "Escribí tus logros en viñetas cortas (una idea por línea).";
    fixes = ["write_achievement"];
  } else if (good < total) {
    advice = `Acortá o ajustá ${total - good} de ${total} viñetas: una idea por línea, entre ${BULLET_MIN_WORDS} y ${BULLET_MAX_WORDS} palabras.`;
    fixes = ["edit_history"];
  }
  return scored("readability", score, advice, fixes, true);
}

/** Largo: cuántas palabras tiene todo el CV, contra un rango cómodo de leer. */
function lengthItem(b: Bounded): CvDiagnosisItem {
  if (!b.hasExperience) return WAITING("length");
  const w = b.totalWords;
  const score =
    w === 0
      ? 0
      : w < IDEAL_WORDS_MIN
        ? (w / IDEAL_WORDS_MIN) * 10
        : w <= IDEAL_WORDS_MAX
          ? 10
          : 10 - ((w - IDEAL_WORDS_MAX) / IDEAL_WORDS_MIN) * 2;
  let advice = "Un largo cómodo de leer.";
  let fixes: CvDiagnosisFix[] = [];
  if (w < IDEAL_WORDS_MIN) {
    advice = "El CV quedó corto: sumá detalle a tu experiencia.";
    fixes = ["write_achievement"];
  } else if (w > IDEAL_WORDS_MAX) {
    advice = "El CV quedó largo: dejá lo más relevante para el puesto.";
    fixes = ["edit_history"];
  }
  return scored("length", score, advice, fixes, true);
}

const SOON = (id: CvDiagnosisItemId): CvDiagnosisItem => ({
  id,
  status: "soon",
  score: null,
  level: null,
  advice: null,
});

/** Palabras clave: cuántas de las 15 skills más pedidas del puesto nombra el CV (ver `cv-keywords.ts`). */
function keywordsItem(b: Bounded, market: KeywordMarket | null | undefined): CvDiagnosisItem {
  if (!market) return SOON("keywords");
  const r = analyzeCvKeywords(b.texts, market);
  if (r.status === "no_data") {
    return { id: "keywords", status: "no_data", score: null, level: null, advice: null };
  }
  const advice =
    r.missing.length === 0
      ? "Tu CV nombra las skills más pedidas para tu puesto."
      : `Estas skills se piden mucho para tu puesto y tu CV no las nombra: ${r.missing.join(", ")}. Sumalas solo si de verdad las tenés.`;
  return scored("keywords", r.score, advice, r.missing.length === 0 ? [] : ["mark_keywords"]);
}

/**
 * Logros medibles: cuántas viñetas traen un número, un porcentaje, un plazo o una cantidad (`cv-measurable.ts`).
 * Con experiencia y viñetas vagas (C-42) el paso es reescribirlas con ayuda, no «cargar experiencia».
 */
function achievementsItem(b: Bounded): CvDiagnosisItem {
  if (!b.hasExperience) return WAITING("achievements");
  const r = analyzeCvMeasurable(b.resultBullets);
  let advice: string;
  let fixes: CvDiagnosisFix[] = ["write_achievement"];
  if (r.total === 0) {
    advice =
      "Escribí tus logros en viñetas de experiencia o proyectos y sumales un resultado: un número, un porcentaje, un plazo o una cantidad de personas.";
  } else if (r.example === null) {
    advice = "Tus viñetas muestran resultados que se pueden medir.";
    fixes = [];
  } else {
    advice = `A «${r.example}» le falta un resultado. Plantilla: lo que hiciste + cuánto cambió (un porcentaje, una cantidad, un plazo o «de X a Y»). Agregalo solo si lo sabés con certeza.`;
  }
  return scored("achievements", r.score, advice, fixes, true);
}

/** Diagnóstico del CV: los seis ítems, siempre en el mismo orden. */
export function diagnoseCv(doc: CvDocument, opts: CvDiagnosisOptions = {}): CvDiagnosisItem[] {
  const b = bound(doc);
  return [
    structureItem(b),
    keywordsItem(b, opts.keywords),
    readabilityItem(b),
    lengthItem(b),
    achievementsItem(b),
    sectionsItem(b),
  ];
}
