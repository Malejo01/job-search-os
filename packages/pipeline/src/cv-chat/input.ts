/**
 * Clasificación del mensaje de la persona antes de mandarlo al modelo (C-25, ADR-008). Si pegó un CV
 * entero, se la deriva a la lectura de CV (la 81) y el texto no va al modelo del chat. Heurística pura.
 */
import { detectCvInjection } from "../cv/injection";
import { foldCvText } from "../cv-out/verify";

export const CV_CHAT_MAX_INPUT_CHARS = 2000;

export type CvChatInputKind =
  | { kind: "ok" }
  | { kind: "empty" }
  | { kind: "too_long" }
  | { kind: "pasted_cv" }
  | { kind: "injection"; signals: string[] };

const HEADERS = new Set([
  "experiencia",
  "experiencia laboral",
  "experiencia profesional",
  "educacion",
  "formacion",
  "formacion academica",
  "estudios",
  "habilidades",
  "skills",
  "competencias",
  "idiomas",
  "certificaciones",
  "cursos",
  "perfil",
  "perfil profesional",
  "resumen",
  "resumen profesional",
  "datos personales",
  "referencias",
  "experience",
  "work experience",
  "professional experience",
  "education",
  "languages",
  "certifications",
  "summary",
  "professional summary",
  "profile",
  "projects",
  "proyectos",
]);

const RANGE_RE =
  /\b(?:(?:0?[1-9]|1[0-2])[/.-])?(?:19|20)\d{2}\s*(?:-|–|—|\ba\b|\bto\b)\s*(?:(?:(?:0?[1-9]|1[0-2])[/.-])?(?:19|20)\d{2}|actual|presente|present|hoy|current|now)\b/gi;

/** Líneas cortas que son un título de sección típico de CV. */
export function countCvHeaders(text: string): number {
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const t = foldCvText(line)
      .replace(/[:·•\-–—_*#|]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (t.length > 0 && t.length <= 40 && HEADERS.has(t)) seen.add(t);
  }
  return seen.size;
}

/** ¿Parece un CV entero? Texto largo con varias secciones y rangos de fechas. */
export function looksLikePastedCv(text: string): boolean {
  const len = text.length;
  if (len < 600) return false;
  const headers = countCvHeaders(text);
  const ranges = (text.match(RANGE_RE) ?? []).length;
  if (len >= 1200 && headers >= 3) return true;
  if (len >= 600 && headers >= 4) return true;
  return len >= 1200 && headers >= 2 && ranges >= 3;
}

export function classifyCvChatInput(text: string): CvChatInputKind {
  if (text.trim() === "") return { kind: "empty" };
  if (looksLikePastedCv(text)) return { kind: "pasted_cv" };
  if (text.length > CV_CHAT_MAX_INPUT_CHARS) return { kind: "too_long" };
  const inj = detectCvInjection(text);
  if (inj.hit) return { kind: "injection", signals: inj.signals };
  return { kind: "ok" };
}
