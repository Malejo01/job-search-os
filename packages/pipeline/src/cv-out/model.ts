/**
 * Modelo del CV (C-25 / 100 §3.2): la única fuente de la vista previa, del DOCX y de la impresión. Puro:
 * recibe datos confirmados por la persona y devuelve secciones y faltantes. No lleva foto, nacimiento,
 * documento, estado civil ni dirección: ni siquiera existen en los tipos de entrada. El teléfono es
 * opcional y solo sale si la persona lo cargó y marcó «incluir» (R33-07).
 */
import { cvGroupSkills, cvLanguageLevelText, cvNotices, type CvNotice } from "./quality";
import { cleanCvText, CV_BULLET_MAX_CHARS, foldCvText } from "./verify";

export type CvLang = "es" | "en";
export type CvHistoryKind = "trabajo" | "educacion" | "certificacion" | "proyecto";

export const CV_MAX_HISTORY_ENTRIES = 20;
export const CV_MAX_BULLETS = 6;
/** Tope del link de un proyecto: el mismo CHECK de `career_history.link`. */
export const CV_PROJECT_LINK_MAX_CHARS = 200;

/**
 * Una fila de `career_history` (sin importar `db`). Los meses son `AAAA-MM`. En un proyecto (R12-4,
 * ADR-038 §6), `organization` es el nombre del proyecto, `title` el rol, las viñetas la descripción y los
 * logros, y el stack va como viñeta «Stack: …». `link` solo vale en proyectos.
 */
export interface CvHistoryInput {
  kind: CvHistoryKind;
  organization: string;
  title: string;
  startMonth: string | null;
  endMonth: string | null;
  bullets: readonly string[];
  link?: string | null;
}

// https, host con punto y sin credenciales ni `@` (nada de emails), solo ASCII visible.
const PROJECT_LINK_RE =
  /^https:\/\/[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+(?::\d{1,5})?(?:[/?#][\x21-\x7e]*)?$/;
// Un email metido en el camino o en la query (`?mail=yo@ejemplo.test`); `/@usuario` sí vale.
const LINK_EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/;

/**
 * Link de un proyecto, o `null` si no cumple: https, hasta 200 caracteres, sin espacios, sin
 * credenciales ni emails. Lo usan la carga manual del historial y el CV (que no confía en la base).
 */
export function cvProjectLink(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim();
  if (v === "" || v.length > CV_PROJECT_LINK_MAX_CHARS) return null;
  return PROJECT_LINK_RE.test(v) && !LINK_EMAIL_RE.test(v) ? v : null;
}

/** Tope de la etiqueta del cuarto link («Behance», «Blog»). */
export const CV_OTHER_LABEL_MAX_CHARS = 30;
/** Etiqueta corta en texto plano: letras, números, espacios y `. & + -`. Sin links ni emails. */
const OTHER_LABEL_RE = /^[\p{L}\p{N}][\p{L}\p{N} .&+-]*$/u;

/** Etiqueta del «otro» link, o `null` si no cumple (vacía, larga, con símbolos, link o email). */
export function cvOtherLabel(raw: string | null | undefined): string | null {
  const v = (raw ?? "").replace(/\s+/g, " ").trim();
  if (v === "" || v.length > CV_OTHER_LABEL_MAX_CHARS || !OTHER_LABEL_RE.test(v)) return null;
  return cleanCvText(v, CV_OTHER_LABEL_MAX_CHARS) === v ? v : null;
}

const PHONE_RE = /^[+(]?\d[\d\s()-]*$/;
export const CV_PHONE_MAX_CHARS = 25;

/**
 * Teléfono, o `null` si no cumple: solo dígitos, espacios, `+` al inicio, `-` y paréntesis, de 6 a 15
 * dígitos y hasta 25 caracteres. Falla cerrado: nada de letras, links ni emails.
 */
export function cvPhone(raw: string | null | undefined): string | null {
  const v = (raw ?? "").replace(/\s+/g, " ").trim();
  if (v === "" || v.length > CV_PHONE_MAX_CHARS || !PHONE_RE.test(v)) return null;
  const digits = v.replace(/\D/g, "").length;
  return digits >= 6 && digits <= 15 ? v : null;
}

export interface CvLinksInput {
  linkedin?: string | null;
  github?: string | null;
  portfolio?: string | null;
  /** Cuarto link con su etiqueta corta (R33-07, C-45). */
  other?: { label: string | null; url: string | null } | null;
}

export interface CvSkillInput {
  name: string;
  category?: string | null;
}

export interface CvLanguageInput {
  name: string;
  /** Ej. `B2`, `Nativo`. */
  level?: string | null;
}

export interface CvSourceData {
  displayName: string;
  email?: string | null;
  /** Teléfono que la persona cargó (R33-07). Solo sale si pide incluirlo (`includePhone`). */
  phone?: string | null;
  city?: string | null;
  country?: string | null;
  links?: CvLinksInput;
  headline?: string | null;
  summary?: string | null;
  skills: readonly CvSkillInput[];
  languages: readonly CvLanguageInput[];
  achievements: readonly string[];
  history: readonly CvHistoryInput[];
}

export interface CvBuildOptions {
  lang: CvLang;
  /** Por defecto se incluye el email si hay. */
  includeEmail?: boolean;
  /** Ciudad y país en el encabezado (R33-07). Por defecto se incluyen si hay; no es la dirección. */
  includePlace?: boolean;
  /** Teléfono en el encabezado (R33-07): **sin marcar por defecto**; solo sale si es `true` y hay uno válido. */
  includePhone?: boolean;
  /**
   * Mes actual (`AAAA-MM`), que pone quien llama: el paquete no mira el reloj (ADR-001). Un trabajo que
   * termina en ese mes se muestra como «Actualidad» (R33-09, C-62).
   */
  today?: string | null;
}

export type CvSectionId =
  | "summary"
  | "experience"
  | "projects"
  | "education"
  | "certifications"
  | "skills"
  | "languages"
  | "achievements";

/** `heading` es el cargo o título; `detail`, la organización con las fechas; o un párrafo suelto. */
export interface CvBlock {
  heading: string | null;
  detail: string | null;
  bullets: string[];
}

export interface CvSection {
  id: CvSectionId;
  title: string;
  blocks: CvBlock[];
}

export type CvMissing = "summary" | "experience" | "education" | "skills" | "languages" | "links";

export interface CvDocument {
  lang: CvLang;
  name: string;
  headline: string | null;
  contact: string[];
  sections: CvSection[];
  missing: CvMissing[];
  /** Avisos suaves (R33-09): no cambian el CV, solo orientan a la persona. */
  notices?: CvNotice[];
}

export const CV_SECTION_TITLES: Record<CvLang, Record<CvSectionId, string>> = {
  es: {
    summary: "Resumen",
    experience: "Experiencia",
    projects: "Proyectos",
    education: "Educación",
    certifications: "Certificaciones",
    // R33-07 (C-47): un solo idioma en los títulos de la versión en español
    skills: "Habilidades",
    languages: "Idiomas",
    achievements: "Logros",
  },
  en: {
    summary: "Summary",
    experience: "Experience",
    projects: "Projects",
    education: "Education",
    certifications: "Certifications",
    skills: "Skills",
    languages: "Languages",
    achievements: "Achievements",
  },
};

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

function plain(s: string | null | undefined, max = 160): string {
  return cleanCvText(s ?? "", max);
}

/** `AAAA-MM` → `MM/AAAA`; lo que no cumple el formato se descarta. */
function fmtMonth(m: string | null): string | null {
  const hit = m ? MONTH_RE.exec(m) : null;
  return hit ? `${hit[2]}/${hit[1]}` : null;
}

/**
 * `MM/AAAA – MM/AAAA`, `MM/AAAA – Actualidad` (solo trabajos) o vacío. Un trabajo que termina en `today`
 * (el mes actual) sigue en curso: también dice «Actualidad» (C-62).
 */
export function cvDateRange(entry: CvHistoryInput, lang: CvLang, today?: string | null): string {
  const start = fmtMonth(entry.startMonth);
  const end = fmtMonth(entry.endMonth);
  const now = lang === "es" ? "Actualidad" : "Present";
  const stillThere = entry.kind === "trabajo" && !!today && entry.endMonth === today;
  if (start && stillThere) return `${start} – ${now}`;
  if (start && end) return `${start} – ${end}`;
  if (start) return entry.kind === "trabajo" ? `${start} – ${now}` : start;
  return end ?? "";
}

function uniqueFolded(items: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const it of items) {
    const k = foldCvText(it);
    if (it === "" || seen.has(k)) continue;
    seen.add(k);
    out.push(it);
  }
  return out;
}

function historyBlocks(
  history: readonly CvHistoryInput[],
  kind: CvHistoryKind,
  lang: CvLang,
  today?: string | null,
): CvBlock[] {
  const blocks: CvBlock[] = [];
  for (const e of history.slice(0, CV_MAX_HISTORY_ENTRIES)) {
    if (e.kind !== kind) continue;
    const title = plain(e.title, 120);
    const org = plain(e.organization, 120);
    if (title === "" && org === "") continue;
    const bullets = uniqueFolded(
      e.bullets.map((b) => cleanCvText(b, CV_BULLET_MAX_CHARS)).filter((b) => b !== ""),
    ).slice(0, CV_MAX_BULLETS);
    if (kind === "proyecto") {
      // Proyecto: el nombre arriba; abajo el rol, las fechas y el link (texto plano, legible por ATS)
      const projectDetail = [
        org ? title : "",
        cvDateRange(e, lang, today),
        cvProjectLink(e.link) ?? "",
      ]
        .filter((x) => x !== "")
        .join(" | ");
      blocks.push({ heading: org || title, detail: projectDetail || null, bullets });
      continue;
    }
    const detail = [org, cvDateRange(e, lang, today)].filter((x) => x !== "").join(" | ");
    blocks.push({
      heading: title || org,
      detail: title ? detail || null : cvDateRange(e, lang, today) || null,
      bullets,
    });
  }
  return blocks;
}

function skillBlocks(skills: readonly CvSkillInput[], lang: CvLang): CvBlock[] {
  const other = lang === "es" ? "Otras" : "Other";
  const clean = skills
    // La categoría va sin tocar: las de la taxonomía son claves en minúscula (`cloud`, `datos`)
    .map((s) => ({ name: plain(s.name, 60), category: (s.category ?? "").trim() || null }))
    .filter((s) => s.name !== "");
  // R33-09 (C-60): categorías con nombres que se entienden y sin las técnicas ajenas al rubro
  const groups = cvGroupSkills(clean, lang).map((g) => ({
    ...g,
    label: g.label === null ? null : plain(g.label, 40) || null,
  }));
  const hasCategories = groups.some((g) => g.label !== null);
  return groups.map((g) => ({
    heading: null,
    detail: `${g.label ?? (hasCategories ? other : "")}${g.label !== null || hasCategories ? ": " : ""}${uniqueFolded(g.names).join(", ")}`,
    bullets: [],
  }));
}

/**
 * Arma el CV desde datos confirmados. Lo que falta queda vacío y va a `missing`; nunca se completa con
 * texto inventado. Las secciones salen en el orden estándar para ATS.
 */
export function buildCvDocument(data: CvSourceData, opts: CvBuildOptions): CvDocument {
  const { lang } = opts;
  const titles = CV_SECTION_TITLES[lang];
  const sections: CvSection[] = [];
  const missing: CvMissing[] = [];
  const add = (id: CvSectionId, blocks: CvBlock[]): boolean => {
    if (blocks.length === 0) return false;
    sections.push({ id, title: titles[id], blocks });
    return true;
  };

  const place =
    opts.includePlace === false
      ? ""
      : [plain(data.city, 60), plain(data.country, 60)].filter((x) => x !== "").join(", ");
  const links = data.links ?? {};
  // R33-07 (C-45): solo https, con la URL completa como texto en el encabezado
  const linkLines = [
    ["LinkedIn", cvProjectLink(links.linkedin)],
    ["GitHub", cvProjectLink(links.github)],
    ["Portfolio", cvProjectLink(links.portfolio)],
    [
      cvOtherLabel(links.other?.label) ?? (lang === "es" ? "Otro" : "Other"),
      cvProjectLink(links.other?.url),
    ],
  ].flatMap(([label, url]) => (url ? [`${label}: ${url}`] : []));
  const email = opts.includeEmail === false ? "" : (data.email ?? "").trim();
  const phone = opts.includePhone === true ? (cvPhone(data.phone) ?? "") : "";
  const contact = [
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "",
    phone,
    place,
    ...linkLines,
  ].filter((x) => x !== "");
  if (linkLines.length === 0) missing.push("links");

  const summary = plain(data.summary, 600);
  if (!add("summary", summary ? [{ heading: null, detail: summary, bullets: [] }] : [])) {
    missing.push("summary");
  }
  const today = opts.today ?? null;
  if (!add("experience", historyBlocks(data.history, "trabajo", lang, today))) {
    missing.push("experience");
  }
  add("projects", historyBlocks(data.history, "proyecto", lang, today));
  if (!add("education", historyBlocks(data.history, "educacion", lang, today))) {
    missing.push("education");
  }
  add("certifications", historyBlocks(data.history, "certificacion", lang, today));
  if (!add("skills", skillBlocks(data.skills, lang))) missing.push("skills");
  // R33-09 (C-64, C-69): cada idioma en su línea, con el nivel explicado; solo los que la persona declaró
  const langs = uniqueFolded(
    data.languages.map((l) => {
      const n = plain(l.name, 40);
      const lv = plain(l.level, 30);
      return n && lv ? `${n}: ${cvLanguageLevelText(lv, lang)}` : n;
    }),
  );
  if (
    !add(
      "languages",
      langs.map((detail) => ({ heading: null, detail, bullets: [] })),
    )
  ) {
    missing.push("languages");
  }
  const achievements = uniqueFolded(
    data.achievements.map((a) => cleanCvText(a, CV_BULLET_MAX_CHARS)),
  );
  add(
    "achievements",
    achievements.length
      ? [{ heading: null, detail: null, bullets: achievements.slice(0, CV_MAX_BULLETS) }]
      : [],
  );

  const doc: CvDocument = {
    lang,
    name: plain(data.displayName, 100),
    headline: plain(data.headline, 120) || null,
    contact,
    sections,
    missing,
  };
  doc.notices = cvNotices(doc, data.skills);
  return doc;
}
