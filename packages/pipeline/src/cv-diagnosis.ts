/**
 * Diagnóstico del CV por ítems. Puro: recibe el CV ya armado (`CvDocument`) y devuelve, por código, un
 * puntaje de 0 a 10, un nivel y un consejo concreto para estructura, secciones y legibilidad (con el largo).
 * Palabras clave de la carrera y logros medibles dependen del modelo (diagnóstico del coach, bajo demanda y
 * con costo): acá quedan en `soon`, sin puntaje inventado. El nivel es un código; las palabras que ve la
 * persona las pone la web. Entrada acotada: ningún campo ni cantidad crece sin tope.
 */
import type { CvDocument, CvSection, CvSectionId } from "./cv-out/model";

export const CV_DIAGNOSIS_ITEM_IDS = [
  "structure",
  "keywords",
  "readability",
  "achievements",
  "sections",
] as const;
export type CvDiagnosisItemId = (typeof CV_DIAGNOSIS_ITEM_IDS)[number];

export type CvDiagnosisLevel = "good" | "improvable" | "missing";

export type CvDiagnosisItem =
  | {
      id: CvDiagnosisItemId;
      status: "scored";
      /** 0 a 10, un decimal. */
      score: number;
      level: CvDiagnosisLevel;
      advice: string;
    }
  | { id: CvDiagnosisItemId; status: "soon"; score: null; level: null; advice: null };

/** Topes de lo que se mira: un CV de 2 MB se recorta, no se procesa entero. */
const MAX_SECTIONS = 20;
const MAX_BLOCKS = 40;
const MAX_BULLETS = 30;
const MAX_FIELD_CHARS = 1_000;
const MAX_TOTAL_CHARS = 200_000;

/** Umbrales de nivel. */
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

const round1 = (n: number) => Math.round(Math.min(10, Math.max(0, n)) * 10) / 10;

function levelOf(score: number): CvDiagnosisLevel {
  if (score >= CV_DIAGNOSIS_GOOD_FROM) return "good";
  if (score >= CV_DIAGNOSIS_IMPROVABLE_FROM) return "improvable";
  return "missing";
}

function scored(id: CvDiagnosisItemId, raw: number, advice: string): CvDiagnosisItem {
  const score = round1(raw);
  return { id, status: "scored", score, level: levelOf(score), advice };
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
  };
  for (const sec of doc.sections.slice(0, MAX_SECTIONS) as CvSection[]) {
    let filled = false;
    for (const block of sec.blocks.slice(0, MAX_BLOCKS)) {
      const heading = take(clip(block.heading));
      const detail = take(clip(block.detail));
      if (heading.trim() !== "" || detail.trim() !== "") filled = true;
      out.totalWords += countWords(heading) + countWords(detail);
      for (const raw of block.bullets.slice(0, MAX_BULLETS)) {
        const b = take(clip(raw));
        if (b.trim() === "") continue;
        filled = true;
        const w = countWords(b);
        out.bulletWords.push(w);
        out.bulletChars.push(b.length);
        out.totalWords += w;
      }
    }
    out.sections.push({ id: sec.id, title: sec.title, filled });
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
  if (b.hasName) score += 2;
  else gaps.push("tu nombre arriba de todo");
  if (b.hasContact) score += 3;
  else gaps.push("un dato de contacto (email o ciudad)");
  if (b.hasHeadline) score += 2;
  else gaps.push("un titular con el puesto que buscás");
  if (orderOk) score += 1.5;
  else if (ids.length > 0) gaps.push("el orden estándar: resumen, experiencia, estudios y skills");
  if (noEmpty) score += 1.5;
  else if (b.sections.length > 0) gaps.push("completar o sacar las secciones vacías");

  const advice =
    gaps.length === 0
      ? "Tiene nombre, contacto, titular y un orden que cualquier sistema de selección lee sin problema."
      : `Sumá o corregí: ${gaps.join("; ")}.`;
  return scored("structure", score, advice);
}

/** Secciones que un CV profesional trae: cada una vale 2 puntos. */
const EXPECTED: { ids: readonly CvSectionId[]; label: string }[] = [
  { ids: ["summary"], label: "Resumen" },
  { ids: ["experience", "projects"], label: "Experiencia (o proyectos)" },
  { ids: ["education"], label: "Educación" },
  { ids: ["skills"], label: "Skills" },
  { ids: ["languages"], label: "Idiomas" },
];

function sectionsItem(b: Bounded): CvDiagnosisItem {
  const missing = EXPECTED.filter((e) => !b.sections.some((s) => s.filled && e.ids.includes(s.id)));
  const score = (EXPECTED.length - missing.length) * 2;
  const advice =
    missing.length === 0
      ? "Están todas las secciones que se esperan en un CV profesional."
      : `Te faltan: ${missing.map((m) => m.label).join(", ")}. Cargalas en tu historial o con el coach.`;
  return scored("sections", score, advice);
}

function readabilityItem(b: Bounded): CvDiagnosisItem {
  const total = b.bulletWords.length;
  const good = b.bulletWords.filter(
    (w, i) =>
      w >= BULLET_MIN_WORDS && w <= BULLET_MAX_WORDS && b.bulletChars[i]! <= BULLET_MAX_CHARS,
  ).length;
  const bulletScore = total === 0 ? 0 : (good / total) * 10;

  const w = b.totalWords;
  const lengthScore =
    w === 0
      ? 0
      : w < IDEAL_WORDS_MIN
        ? (w / IDEAL_WORDS_MIN) * 10
        : w <= IDEAL_WORDS_MAX
          ? 10
          : 10 - ((w - IDEAL_WORDS_MAX) / IDEAL_WORDS_MIN) * 2;

  const tips: string[] = [];
  if (total === 0) tips.push("escribí tus logros en viñetas cortas (una idea por línea)");
  else if (good < total) {
    tips.push(
      `acortá o ajustá ${total - good} de ${total} viñetas: una idea por línea, entre ${BULLET_MIN_WORDS} y ${BULLET_MAX_WORDS} palabras`,
    );
  }
  if (w > 0 && w < IDEAL_WORDS_MIN) tips.push("el CV quedó corto: sumá detalle a tu experiencia");
  if (w > IDEAL_WORDS_MAX) tips.push("el CV quedó largo: dejá lo más relevante para el puesto");
  const advice =
    tips.length === 0
      ? "Viñetas cortas y un largo cómodo de leer."
      : `${tips.join("; ").replace(/^./, (c) => c.toUpperCase())}.`;
  return scored("readability", (bulletScore + lengthScore) / 2, advice);
}

const SOON = (id: CvDiagnosisItemId): CvDiagnosisItem => ({
  id,
  status: "soon",
  score: null,
  level: null,
  advice: null,
});

/** Diagnóstico del CV: los cinco ítems, siempre en el mismo orden. */
export function diagnoseCv(doc: CvDocument): CvDiagnosisItem[] {
  const b = bound(doc);
  return [
    structureItem(b),
    SOON("keywords"),
    readabilityItem(b),
    SOON("achievements"),
    sectionsItem(b),
  ];
}
