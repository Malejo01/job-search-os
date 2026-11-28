/**
 * Calidad del CV (R33-09, C-56 a C-69) y avisos antes de descargar (R33-07, C-46). Puro: mira el modelo ya
 * armado y devuelve avisos y preguntas. Nada de esto escribe en el CV: el CV nunca suma un dato que la
 * persona no declaró (C-69), nunca quita una habilidad (C-61) y nunca reescribe una viñeta por su cuenta
 * (C-68). Las preguntas guía no traen cifras ni ejemplos inventados: citan las palabras de la persona.
 */
import type { CvDocument, CvLang } from "./model";
import { foldCvText } from "./verify";

// ---------------------------------------------------------------------------------------------
// Idioma con su nivel explicado (C-64)
// ---------------------------------------------------------------------------------------------

const CEFR_LABELS: Record<CvLang, Record<string, string>> = {
  es: {
    A1: "principiante",
    A2: "básico",
    B1: "intermedio",
    B2: "intermedio alto",
    C1: "avanzado",
    C2: "dominio pleno",
  },
  en: {
    A1: "beginner",
    A2: "basic",
    B1: "intermediate",
    B2: "upper intermediate",
    C1: "advanced",
    C2: "proficient",
  },
};

/**
 * `A2` → `A2, nivel básico` (en inglés, `A2, basic level`). Un nivel que no es del marco europeo (`Nativo`,
 * `Intermedio`) queda como lo escribió la persona: no se le agrega nada.
 */
export function cvLanguageLevelText(level: string, lang: CvLang): string {
  const key = level.trim().toUpperCase();
  const label = CEFR_LABELS[lang][key];
  if (!label) return level.trim();
  return lang === "es" ? `${key}, nivel ${label}` : `${key}, ${label} level`;
}

// ---------------------------------------------------------------------------------------------
// Categorías de habilidades según el rubro (C-60)
// ---------------------------------------------------------------------------------------------

/** Categorías de la taxonomía (`skill_category`) con su nombre para el CV. `technical` = de tecnología. */
const CATEGORY_LABELS: Record<string, { es: string; en: string; technical: boolean } | null> = {
  cloud: { es: "Nube", en: "Cloud", technical: true },
  infra: { es: "Infraestructura", en: "Infrastructure", technical: true },
  testing: { es: "Pruebas", en: "Testing", technical: true },
  llm_ops: { es: "Herramientas de IA", en: "AI tools", technical: true },
  ai_core: { es: "Inteligencia artificial", en: "Artificial intelligence", technical: true },
  lenguaje: { es: "Lenguajes de programación", en: "Programming languages", technical: true },
  framework: { es: "Frameworks", en: "Frameworks", technical: true },
  datos: { es: "Datos y analítica", en: "Data and analytics", technical: false },
  soft: { es: "Habilidades personales", en: "Soft skills", technical: false },
  idioma: { es: "Idiomas", en: "Languages", technical: false },
  dominio: { es: "Conocimiento del rubro", en: "Industry knowledge", technical: false },
  // «otra» es lo mismo que sin categoría: lo resuelve quien llama
  otra: null,
};

export interface CvSkillGroup {
  /** `null` = sin categoría o «otra» (el modelo lo rotula «Otras»). */
  label: string | null;
  names: string[];
}

/**
 * Agrupa las habilidades con nombres que se entienden. Las categorías de la taxonomía se traducen; las
 * técnicas (nube, infraestructura, lenguajes…) solo se muestran con su nombre si el perfil es técnico (la
 * mitad o más de las habilidades con categoría son técnicas). En otro rubro se juntan en «Herramientas»: un
 * perfil de marketing no muestra «Nube: Vercel». Una categoría escrita a mano (no de la taxonomía) se respeta.
 */
export function cvGroupSkills(
  skills: readonly { name: string; category?: string | null }[],
  lang: CvLang,
): CvSkillGroup[] {
  const cat = (s: { category?: string | null }) => (s.category ?? "").trim();
  // Solo claves propias: «constructor» o «__proto__» escritos a mano no son categorías de la taxonomía
  const entryOf = (raw: string) =>
    Object.hasOwn(CATEGORY_LABELS, raw) ? CATEGORY_LABELS[raw] : undefined;
  const known = skills.filter((s) => {
    const c = entryOf(cat(s));
    return c && cat(s) !== "soft" && cat(s) !== "idioma";
  });
  const technical = known.filter((s) => entryOf(cat(s))!.technical).length;
  const isTechnicalProfile = known.length > 0 && technical / known.length >= 0.5;
  const tools = lang === "es" ? "Herramientas" : "Tools";

  const groups = new Map<string | null, string[]>();
  for (const s of skills) {
    const raw = cat(s);
    let label: string | null;
    if (raw === "") label = null;
    else if (Object.hasOwn(CATEGORY_LABELS, raw)) {
      const entry = CATEGORY_LABELS[raw];
      if (!entry) label = null;
      else if (entry.technical && !isTechnicalProfile) label = tools;
      else label = entry[lang];
    } else label = raw;
    const list = groups.get(label) ?? [];
    list.push(s.name);
    groups.set(label, list);
  }
  // Sin categoría al final
  const out: CvSkillGroup[] = [];
  for (const [label, names] of groups) if (label !== null) out.push({ label, names });
  const rest = groups.get(null);
  if (rest) out.push({ label: null, names: rest });
  return out;
}

// ---------------------------------------------------------------------------------------------
// Avisos suaves sobre el contenido
// ---------------------------------------------------------------------------------------------

export interface CvTaskBullet {
  /** La viñeta tal como la escribió la persona. */
  text: string;
  /** Preguntas guía con sus propias palabras; nunca traen una respuesta hecha. */
  questions: string[];
}

export type CvNotice =
  | { id: "no_headline" }
  | { id: "skills_without_evidence"; skills: string[] }
  | { id: "task_bullets"; items: CvTaskBullet[] };

/** Verbos que arrancan una viñeta de tarea («ejecuté tareas de…», «gestioné…»), ya sin tildes. */
const TASK_START_RE = new RegExp(
  "^(?:ejecut|realiz|gestion|colabor|particip|apoy|ayud|manej|trabaj|tareas? de|responsable de|me encarg|encargad|worked on|responsible for|handled|helped|assisted|participated|performed|managed tasks|duties)",
);

const MAX_NOTICE_ITEMS = 5;
const QUOTE_MAX_CHARS = 70;

function quote(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= QUOTE_MAX_CHARS) return t.replace(/[.;,]+$/, "");
  const slice = t.slice(0, QUOTE_MAX_CHARS);
  const space = slice.lastIndexOf(" ");
  return `${(space > 30 ? slice.slice(0, space) : slice).replace(/[.;,]+$/, "")}…`;
}

/**
 * Preguntas guía para pasar de una tarea a un logro (C-67). Citan la viñeta de la persona y piden hechos;
 * no sugieren cifras ni resultados, y avisan que lo que no se midió no se suma.
 */
export function cvBulletGuideQuestions(bullet: string, lang: CvLang): string[] {
  const q = quote(bullet);
  return lang === "es"
    ? [
        `¿Qué hacías en concreto en «${q}»? ¿Con qué frecuencia y en qué plataforma o herramienta?`,
        "¿Para quién o para cuántos lo hacías (clientes, equipo, sucursales, canales)?",
        "¿Notaste algún cambio o resultado? Si no lo mediste, no lo sumes: solo lo que pasó de verdad.",
      ]
    : [
        `What exactly did you do in "${q}"? How often, and on which platform or tool?`,
        "Who or how many did you do it for (customers, team, branches, channels)?",
        "Did you notice any change or result? If you did not measure it, do not add it: only what really happened.",
      ];
}

/** ¿La viñeta cuenta una tarea y no un logro? Sin cifras y arrancando con un verbo o frase de tarea. */
export function cvIsTaskBullet(bullet: string): boolean {
  const f = foldCvText(bullet).trim();
  if (/\d/.test(f)) return false;
  return TASK_START_RE.test(f);
}

function allBullets(doc: CvDocument, ids: readonly string[]): string[] {
  return doc.sections
    .filter((s) => ids.includes(s.id))
    .flatMap((s) => s.blocks.flatMap((b) => b.bullets));
}

function evidenceText(doc: CvDocument): string {
  const parts: string[] = [];
  for (const s of doc.sections) {
    if (s.id === "skills" || s.id === "languages") continue;
    for (const b of s.blocks) {
      if (b.heading) parts.push(b.heading);
      if (b.detail) parts.push(b.detail);
      parts.push(...b.bullets);
    }
  }
  return ` ${foldCvText(parts.join(" "))
    .replace(/[^\p{L}\p{N}#+.]+/gu, " ")
    .replace(/\.(?=\s|$)/g, "")} `;
}

/**
 * Habilidades que no aparecen en ninguna viñeta, título ni resumen (C-61). Aviso suave: la habilidad queda
 * en el CV; solo se le avisa a la persona para que, si es verdad, la muestre en su experiencia. Los idiomas
 * y las habilidades personales no se miran.
 */
export function cvSkillsWithoutEvidence(
  doc: CvDocument,
  skills: readonly { name: string; category?: string | null }[],
): string[] {
  const text = evidenceText(doc);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const s of skills) {
    const c = (s.category ?? "").trim();
    if (c === "soft" || c === "idioma") continue;
    const key = foldCvText(s.name)
      .replace(/[^\p{L}\p{N}#+.]+/gu, " ")
      .trim();
    if (key === "" || seen.has(key)) continue;
    seen.add(key);
    if (!text.includes(` ${key} `)) out.push(s.name);
  }
  return out;
}

/** Avisos suaves del CV ya armado. Ninguno cambia el CV. */
export function cvNotices(
  doc: CvDocument,
  skills: readonly { name: string; category?: string | null }[],
): CvNotice[] {
  const notices: CvNotice[] = [];
  if (!doc.headline) notices.push({ id: "no_headline" });
  const tasks = allBullets(doc, ["experience", "projects"])
    .filter(cvIsTaskBullet)
    .slice(0, MAX_NOTICE_ITEMS)
    .map((text) => ({ text, questions: cvBulletGuideQuestions(text, doc.lang) }));
  if (tasks.length > 0) notices.push({ id: "task_bullets", items: tasks });
  const unproven = cvSkillsWithoutEvidence(doc, skills);
  // Sin ninguna viñeta de experiencia no hay dónde buscar: no se avisa de cada habilidad
  const hasExperienceText = allBullets(doc, ["experience", "projects"]).length > 0;
  if (unproven.length > 0 && hasExperienceText) {
    notices.push({ id: "skills_without_evidence", skills: unproven.slice(0, 8) });
  }
  return notices;
}

// ---------------------------------------------------------------------------------------------
// Aviso antes de descargar (C-46)
// ---------------------------------------------------------------------------------------------

export type CvDownloadWarning = "education" | "summary" | "results";

/**
 * Qué le falta al CV antes de bajarlo: estudios, resumen o resultados en los logros (ninguna viñeta con una
 * cifra). Es un aviso: la persona puede descargar igual.
 */
export function cvDownloadWarnings(doc: CvDocument): CvDownloadWarning[] {
  const out: CvDownloadWarning[] = [];
  if (doc.missing.includes("education")) out.push("education");
  if (doc.missing.includes("summary")) out.push("summary");
  const bullets = allBullets(doc, ["experience", "projects", "achievements"]);
  if (bullets.length > 0 && !bullets.some((b) => /\d/.test(b))) out.push("results");
  return out;
}

// ---------------------------------------------------------------------------------------------
// Antes y después de una reescritura (C-68)
// ---------------------------------------------------------------------------------------------

export interface CvBeforeAfter {
  before: string;
  after: string;
  /** ¿La reescritura cambió algo? Si no, no hay nada que elegir. */
  changed: boolean;
  /** Palabras de la persona (4 letras o más) que siguen en la reescritura. */
  keptWords: string[];
  /** Palabras de la persona que la reescritura sacó. */
  droppedWords: string[];
  /** ¿Conserva al menos la mitad de las palabras de la persona? */
  keepsOwnWords: boolean;
}

function words(s: string): string[] {
  return foldCvText(s).match(/[\p{L}\p{N}]{4,}/gu) ?? [];
}

/**
 * Compara la viñeta de la persona con una reescritura para mostrar «antes» y «después» y dejarla elegir.
 * Es una comparación: no decide nada, y la reescritura nunca reemplaza a la original sin que se elija.
 */
export function cvBeforeAfter(before: string, after: string): CvBeforeAfter {
  const b = before.replace(/\s+/g, " ").trim();
  const a = after.replace(/\s+/g, " ").trim();
  const own = [...new Set(words(b))];
  const now = new Set(words(a));
  const kept = own.filter((w) => now.has(w));
  const dropped = own.filter((w) => !now.has(w));
  return {
    before: b,
    after: a,
    changed: foldCvText(b) !== foldCvText(a),
    keptWords: kept,
    droppedWords: dropped,
    keepsOwnWords: own.length === 0 ? true : kept.length / own.length >= 0.5,
  };
}
