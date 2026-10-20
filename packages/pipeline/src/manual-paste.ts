/**
 * Extractor del alta manual "pegar el aviso entero" (ronda 63). Puro y determinista: reglas
 * simples sobre el texto, sin LLM ni red. Falla cerrado: lo que no se encuentra queda `null`
 * (o `desconocida` en la modalidad); nunca se inventa. La persona revisa antes de guardar.
 * Todo está acotado: texto truncado, pocas líneas, líneas recortadas y regex sin anidar.
 */
import { parseManualUrl } from "./manual-url";

export type PastedJobFields = {
  title: string | null;
  company: string | null;
  location: string | null;
  modality: "remoto" | "hibrido" | "presencial" | "desconocida";
  /** Primer http(s) del texto que pasa `parseManualUrl`; si no, null. */
  url: string | null;
  /** El texto pegado, recortado y con saltos normalizados. */
  jdText: string;
};

export const MAX_PASTE_CHARS = 30_000;

const MAX_LINES = 40;
const MAX_LINE_CHARS = 300;
const HEAD_LINES = 5;
const LOCATION_LINES = 8;
const MAX_URL_CANDIDATES = 20;

type Modality = PastedJobFields["modality"];

const LABELS = {
  title: /^(?:puesto|cargo|t[ií]tulo|position|job title|role)\s*[:：]\s*(\S.*)$/i,
  company: /^(?:empresa|compa[ñn][ií]a|company)\s*[:：]\s*(\S.*)$/i,
  location: /^(?:ubicaci[oó]n|lugar|location)\s*[:：]\s*(\S.*)$/i,
  modality: /^(?:modalidad|workplace type|work type)\s*[:：]\s*(\S.*)$/i,
};

const GENERIC = [
  "acerca del empleo",
  "about the job",
  "descripcion",
  "descripción",
  "descripcion del puesto",
  "descripción del puesto",
  "job description",
  "easy apply",
  "solicitud sencilla",
];

const PLACES = [
  "argentina",
  "buenos aires",
  "caba",
  "córdoba",
  "cordoba",
  "rosario",
  "mendoza",
  "latam",
  "latinoamérica",
  "latinoamerica",
  "uruguay",
  "chile",
  "méxico",
  "mexico",
  "colombia",
  "españa",
  "espana",
];

const REMOTE = /\b(?:remoto|remote|work from home|trabajo remoto)\b/;
const HYBRID = /\b(?:h[ií]brido|hybrid)\b/;
const ONSITE = /\b(?:presencial|on-site|onsite|in office)\b/;

function modalityOf(text: string): Modality {
  const t = text.toLowerCase();
  const found: Modality[] = [];
  if (REMOTE.test(t)) found.push("remoto");
  if (HYBRID.test(t)) found.push("hibrido");
  if (ONSITE.test(t)) found.push("presencial");
  return found.length === 1 ? (found[0] ?? "desconocida") : "desconocida";
}

function clip(s: string, max: number): string {
  return s.trim().slice(0, max).trim();
}

function isUrlLine(line: string): boolean {
  return /^https?:\/\//i.test(line);
}

/** "Algo corto:" al principio: es una etiqueta (de otra cosa), no un título. */
function isLabelLine(line: string): boolean {
  return /^[\p{L} ]{1,30}[:：]/u.test(line);
}

function isGeneric(line: string): boolean {
  return GENERIC.includes(line.toLowerCase().replace(/[:.]$/, "").trim());
}

function hasPlace(s: string): boolean {
  const t = s.toLowerCase();
  return PLACES.some((p) => t.includes(p));
}

function findUrl(text: string): string | null {
  const re = /https?:\/\/[^\s<>"')\]]{1,2000}/gi;
  let n = 0;
  for (const m of text.matchAll(re)) {
    if (++n > MAX_URL_CANDIDATES) break;
    const parsed = parseManualUrl(m[0].replace(/[.,;:!?]+$/, ""));
    if (parsed.ok && parsed.url) return parsed.url;
  }
  return null;
}

/** "<A> <sep> <B>" partiendo en la última aparición del separador (indexOf, sin regex). */
function splitLast(line: string, sep: string): [string, string] | null {
  const i = line.toLowerCase().lastIndexOf(sep);
  if (i <= 0) return null;
  const a = line.slice(0, i).trim();
  const b = line.slice(i + sep.length).trim();
  return a && b ? [a, b] : null;
}

function titleCompanyFromLine(line: string): { title: string; company: string } | null {
  if (line.length >= 120 || isUrlLine(line) || isLabelLine(line)) return null;
  const hiring = /^(.{1,150}?)\s+(?:est[aá] buscando|is hiring(?: an?)?)\s+(.{1,150})$/i.exec(line);
  if (hiring?.[1] && hiring[2]) return { company: hiring[1], title: hiring[2] };
  for (const sep of [" at ", " en "]) {
    const parts = splitLast(line, sep);
    // Más estricto que "hiring": una frase cualquiera con "en" no es un título
    if (parts && line.length <= 90 && !/[.,;]/.test(line) && parts[1].split(/\s+/).length <= 6) {
      return { title: parts[0], company: parts[1] };
    }
  }
  return null;
}

export function extractPastedJob(text: string): PastedJobFields {
  const normalized = text.slice(0, MAX_PASTE_CHARS).replace(/\r\n?/g, "\n").trim();
  const lines = normalized.split("\n", MAX_LINES).map((l) => l.trim().slice(0, MAX_LINE_CHARS));
  const nonEmpty = lines.filter((l) => l !== "");

  let title: string | null = null;
  let company: string | null = null;
  let location: string | null = null;
  let labelModality: Modality | null = null;

  // 1) Etiquetas explícitas
  for (const line of lines) {
    if (title === null) title = LABELS.title.exec(line)?.[1] ?? null;
    if (company === null) company = LABELS.company.exec(line)?.[1] ?? null;
    if (location === null) location = LABELS.location.exec(line)?.[1] ?? null;
    if (labelModality === null) {
      const v = LABELS.modality.exec(line)?.[1];
      if (v) {
        const m = modalityOf(v);
        if (m !== "desconocida") labelModality = m;
      }
    }
  }

  // 2) Patrones de una línea en las primeras líneas
  if (title === null || company === null) {
    for (const line of nonEmpty.slice(0, HEAD_LINES)) {
      const tc = titleCompanyFromLine(line);
      if (tc) {
        title ??= tc.title;
        company ??= tc.company;
        break;
      }
    }
  }

  // 3) Título: primera línea razonable; la segunda corta es la empresa (estilo LinkedIn)
  if (title === null) {
    const idx = nonEmpty.findIndex(
      (l) => l.length < 120 && !isUrlLine(l) && !isLabelLine(l) && !isGeneric(l),
    );
    const first = idx >= 0 ? nonEmpty[idx] : undefined;
    if (first && idx === 0) {
      title = first;
      const second = nonEmpty[1];
      if (
        company === null &&
        second &&
        second.length <= 60 &&
        second.split(/\s+/).length <= 6 &&
        !/[.:·|]/.test(second) &&
        !isUrlLine(second) &&
        !isGeneric(second) &&
        !hasPlace(second) &&
        !REMOTE.test(second.toLowerCase())
      ) {
        company = second;
      }
    } else if (first) {
      title = first;
    }
  }

  // 4) Ubicación sin etiqueta: línea corta con un lugar conocido, en las primeras líneas
  if (location === null) {
    for (const line of nonEmpty.slice(0, LOCATION_LINES)) {
      if (line.length > 100 || isUrlLine(line) || line === title) continue;
      const segment = line.split("·").find((s) => hasPlace(s));
      if (segment) {
        location = segment.trim();
        break;
      }
    }
  }

  const modality = labelModality ?? modalityOf(lines.join("\n"));

  return {
    title: title ? clip(title, 200) || null : null,
    company: company ? clip(company, 200) || null : null,
    location: location ? clip(location, 120) || null : null,
    modality,
    url: findUrl(normalized),
    jdText: normalized,
  };
}
