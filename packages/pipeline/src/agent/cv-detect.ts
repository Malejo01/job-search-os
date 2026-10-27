import { foldText } from "../normalize/text";
import type { AgentLink } from "./limits";

/**
 * Si la persona pega un CV en el asistente, no se manda al modelo: el CV tiene su propio flujo de
 * lectura, con redacción de datos personales y verificación (ADR-008, ARCHITECTURE §10).
 * Heurística determinista y a propósito generosa: un falso positivo solo deriva a otra pantalla y
 * no escribe nada; un falso negativo manda datos personales al modelo.
 */

const SECTION_HEADERS = [
  "experiencia laboral",
  "experiencia profesional",
  "experiencia",
  "educacion",
  "formacion academica",
  "formacion",
  "estudios",
  "habilidades",
  "skills",
  "idiomas",
  "certificaciones",
  "perfil profesional",
  "datos personales",
  "experience",
  "work experience",
  "work history",
  "education",
  "languages",
  "summary",
  "certifications",
];

const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
const PHONE = /(?:\+?\d[\d\s().-]{7,}\d)/;
const DATE_RANGE =
  /\b(?:(?:ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic|jan|apr|aug|dec)[a-z]*\.?\s+)?(?:19|20)\d{2}\s*[-–—]\s*(?:(?:ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic|jan|apr|aug|dec)[a-z]*\.?\s+)?(?:(?:19|20)\d{2}|actualidad|actual|presente|hoy|present|current|now)\b/gi;

/** Cuántos encabezados de sección de CV aparecen solos en su línea (con o sin «:»). */
function headerCount(text: string): number {
  const found = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = foldText(raw)
      .replace(/[:#*_\-–—|]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (SECTION_HEADERS.includes(line)) found.add(line);
  }
  return found.size;
}

export function looksLikeCv(text: string): boolean {
  const headers = headerCount(text);
  if (headers >= 3) return true;
  if (text.length >= 400 && EMAIL.test(text) && PHONE.test(text)) return true;
  const ranges = text.match(DATE_RANGE)?.length ?? 0;
  return ranges >= 2 && headers >= 1;
}

export const CV_REDIRECT_MESSAGE =
  "Parece que pegaste un CV. El asistente no lo lee: un CV tiene datos personales y se carga por su propio camino, que los saca antes de leerlo. Mientras esa lectura no esté disponible, cargá tus datos a mano en estas pantallas:";

export const CV_REDIRECT_LINKS: readonly AgentLink[] = [
  { href: "/settings/perfil", label: "Tu perfil" },
  { href: "/settings/skills", label: "Tus skills" },
];
