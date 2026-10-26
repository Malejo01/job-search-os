/**
 * Modelo del CV (C-25 / 100 §3.2): la única fuente de la vista previa, del DOCX y de la impresión. Puro:
 * recibe datos confirmados por la persona y devuelve secciones y faltantes. No lleva foto, nacimiento,
 * documento, estado civil, dirección ni teléfono: ni siquiera existen en los tipos de entrada.
 */
import { cleanCvText, CV_BULLET_MAX_CHARS, foldCvText } from "./verify";

export type CvLang = "es" | "en";
export type CvHistoryKind = "trabajo" | "educacion" | "certificacion";

export const CV_MAX_HISTORY_ENTRIES = 20;
export const CV_MAX_BULLETS = 6;

/** Una fila de `career_history` (sin importar `db`). Los meses son `AAAA-MM`. */
export interface CvHistoryInput {
  kind: CvHistoryKind;
  organization: string;
  title: string;
  startMonth: string | null;
  endMonth: string | null;
  bullets: readonly string[];
}

export interface CvLinksInput {
  linkedin?: string | null;
  github?: string | null;
  portfolio?: string | null;
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
}

export type CvSectionId =
  | "summary"
  | "experience"
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
}

export const CV_SECTION_TITLES: Record<CvLang, Record<CvSectionId, string>> = {
  es: {
    summary: "Resumen",
    experience: "Experiencia",
    education: "Educación",
    certifications: "Certificaciones",
    skills: "Skills",
    languages: "Idiomas",
    achievements: "Logros",
  },
  en: {
    summary: "Summary",
    experience: "Experience",
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

function dateRange(entry: CvHistoryInput, lang: CvLang): string {
  const start = fmtMonth(entry.startMonth);
  const end = fmtMonth(entry.endMonth);
  const now = lang === "es" ? "Actual" : "Present";
  if (start && end) return `${start} – ${end}`;
  if (start) return entry.kind === "trabajo" ? `${start} – ${now}` : start;
  return end ?? "";
}

function httpOnly(url: string | null | undefined): string | null {
  const u = (url ?? "").trim();
  return /^https?:\/\/[^\s]+$/i.test(u) ? u : null;
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
): CvBlock[] {
  const blocks: CvBlock[] = [];
  for (const e of history.slice(0, CV_MAX_HISTORY_ENTRIES)) {
    if (e.kind !== kind) continue;
    const title = plain(e.title, 120);
    const org = plain(e.organization, 120);
    if (title === "" && org === "") continue;
    const detail = [org, dateRange(e, lang)].filter((x) => x !== "").join(" | ");
    const bullets = uniqueFolded(
      e.bullets.map((b) => cleanCvText(b, CV_BULLET_MAX_CHARS)).filter((b) => b !== ""),
    ).slice(0, CV_MAX_BULLETS);
    blocks.push({
      heading: title || org,
      detail: title ? detail || null : dateRange(e, lang) || null,
      bullets,
    });
  }
  return blocks;
}

function skillBlocks(skills: readonly CvSkillInput[], lang: CvLang): CvBlock[] {
  const groups = new Map<string, string[]>();
  const other = lang === "es" ? "Otras" : "Other";
  for (const s of skills) {
    const name = plain(s.name, 60);
    if (name === "") continue;
    const cat = plain(s.category, 40) || "";
    const list = groups.get(cat) ?? [];
    list.push(name);
    groups.set(cat, list);
  }
  const blocks: CvBlock[] = [];
  const uncategorized = groups.get("");
  const hasCategories = [...groups.keys()].some((k) => k !== "");
  for (const [cat, names] of groups) {
    if (cat === "") continue;
    blocks.push({
      heading: null,
      detail: `${cat}: ${uniqueFolded(names).join(", ")}`,
      bullets: [],
    });
  }
  if (uncategorized) {
    const label = hasCategories ? `${other}: ` : "";
    blocks.push({
      heading: null,
      detail: `${label}${uniqueFolded(uncategorized).join(", ")}`,
      bullets: [],
    });
  }
  return blocks;
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

  const place = [plain(data.city, 60), plain(data.country, 60)].filter((x) => x !== "").join(", ");
  const links = data.links ?? {};
  const linkLines = [
    ["LinkedIn", httpOnly(links.linkedin)],
    ["GitHub", httpOnly(links.github)],
    ["Portfolio", httpOnly(links.portfolio)],
  ].flatMap(([label, url]) => (url ? [`${label}: ${url}`] : []));
  const email = opts.includeEmail === false ? "" : (data.email ?? "").trim();
  const contact = [
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "",
    place,
    ...linkLines,
  ].filter((x) => x !== "");
  if (linkLines.length === 0) missing.push("links");

  const summary = plain(data.summary, 600);
  if (!add("summary", summary ? [{ heading: null, detail: summary, bullets: [] }] : [])) {
    missing.push("summary");
  }
  if (!add("experience", historyBlocks(data.history, "trabajo", lang))) missing.push("experience");
  if (!add("education", historyBlocks(data.history, "educacion", lang))) missing.push("education");
  add("certifications", historyBlocks(data.history, "certificacion", lang));
  if (!add("skills", skillBlocks(data.skills, lang))) missing.push("skills");
  const langs = uniqueFolded(
    data.languages.map((l) => {
      const n = plain(l.name, 40);
      const lv = plain(l.level, 30);
      return n && lv ? `${n}: ${lv}` : n;
    }),
  );
  if (
    !add(
      "languages",
      langs.length ? [{ heading: null, detail: langs.join(", "), bullets: [] }] : [],
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

  return {
    lang,
    name: plain(data.displayName, 100),
    headline: plain(data.headline, 120) || null,
    contact,
    sections,
    missing,
  };
}
