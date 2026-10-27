import { foldText } from "../normalize/text";
import { err, ok, type Result } from "../result";
import { AGENT_LIMITS, type AgentLink } from "./limits";

/**
 * Si la persona pega un CV en el asistente, no se manda al modelo: el CV tiene su propio flujo de
 * lectura, con redacción de datos personales y verificación (ADR-008, ARCHITECTURE §10).
 * Heurística determinista y a propósito generosa: un falso positivo solo deriva a otras pantallas
 * y no escribe nada; un falso negativo manda datos personales al modelo.
 *
 * Regla (sobre los primeros 20.000 caracteres):
 * - email y teléfono (8 a 15 dígitos, que no sea un rango de años o de montos), con 80+ caracteres;
 * - un perfil de LinkedIn (`linkedin.com/in/`) y al menos un encabezado de CV o un rango de fechas;
 * - 3+ encabezados de CV y además un email, un teléfono o un rango de fechas;
 * - 2+ encabezados de CV y 2+ rangos de fechas.
 * Un encabezado cuenta si está solo en su línea (con viñetas, emojis o numeración delante) o si va
 * seguido de «:» al principio de la línea o después de un punto, «;», «|» o una viñeta.
 */

const MAX_SCAN_CHARS = 20_000;

const SECTION_HEADERS = new Set([
  "experiencia laboral",
  "experiencia profesional",
  "experiencia",
  "antecedentes laborales",
  "educacion",
  "formacion academica",
  "formacion",
  "estudios",
  "habilidades",
  "habilidades tecnicas",
  "conocimientos",
  "skills",
  "top skills",
  "aptitudes principales",
  "idiomas",
  "certificaciones",
  "cursos",
  "referencias",
  "perfil profesional",
  "perfil",
  "profile",
  "datos personales",
  "datos de contacto",
  "contacto",
  "contactar",
  "contact",
  "sobre mi",
  "about me",
  "about",
  "extracto",
  "objetivo",
  "objective",
  "proyectos",
  "projects",
  "experience",
  "work experience",
  "professional experience",
  "work history",
  "employment history",
  "education",
  "languages",
  "summary",
  "professional summary",
  "technical skills",
  "certifications",
]);

// Cuantificadores acotados: nada de backtracking catastrófico sobre texto pegado
const EMAIL = /[a-z0-9._%+-]{1,64}@[a-z0-9.-]{1,253}\.[a-z]{2,24}/i;
const PHONE_CANDIDATE = /\+?\(?\d[\d \t().-]{6,24}\d/g;
const NUMBER_RANGE = /^\d[\d.,]*\s*[-–—]\s*\d[\d.,]*$/;
const LINKEDIN = /linkedin\.com\/in\//i;

const MONTH =
  "(?:ene|feb|mar|abr|may|jun|jul|ago|sep|set|oct|nov|dic|jan|apr|aug|dec)[a-z]{0,10}\\.?";
const DATE_START = `(?:${MONTH}\\s+(?:de\\s+)?|\\d{1,2}\\/)?(?:19|20)\\d{2}`;
const DATE_END = `(?:${DATE_START}|actualidad|actual|presente|present|hoy|today|current|now|la fecha|date)`;
const DATE_RANGE = new RegExp(
  `\\b${DATE_START}(?:\\s*[-–—]\\s*|\\s+(?:to|a|hasta)\\s+)${DATE_END}\\b`,
  "g",
);

/** Encabezado seguido de «:» al principio o después de un punto, «;», «|» o una viñeta. */
const INLINE_HEADER = /(?:^|[.;|•·]|\n)[^\S\n]*([a-z][a-z ]{1,30}?)[^\S\n]*:/g;

const TRAILING = new Set([..." \t\r\n\f\v:.-–—|*#_"]);

/**
 * Línea plegada, sin viñetas, emojis ni numeración al principio ni puntuación al final. El final se
 * recorta con un bucle y no con una regex anclada a `$`, que sería cuadrática sobre una línea larga.
 */
function cleanLine(raw: string): string {
  let line = foldText(raw).replace(/^[^\p{L}]+/u, "");
  let end = line.length;
  while (end > 0 && TRAILING.has(line[end - 1]!)) end--;
  line = line.slice(0, end);
  return line.replace(/\s+/g, " ").trim();
}

function headerCount(folded: string, lines: string[]): number {
  const found = new Set<string>();
  for (const line of lines) if (SECTION_HEADERS.has(line)) found.add(line);
  for (const m of folded.matchAll(INLINE_HEADER)) {
    const h = (m[1] ?? "").trim();
    if (SECTION_HEADERS.has(h)) found.add(h);
  }
  // Prefijo «encabezado:» de una línea que empieza con viñeta o emoji
  for (const line of lines) {
    const prefix = /^([a-z][a-z ]{1,30}?)\s*:/.exec(line);
    if (prefix && SECTION_HEADERS.has(prefix[1]!.trim())) found.add(prefix[1]!.trim());
  }
  return found.size;
}

/** Teléfono: 8 a 15 dígitos, que no sea un rango de años o de montos ni una fecha. */
function hasPhone(text: string): boolean {
  for (const m of text.matchAll(PHONE_CANDIDATE)) {
    const candidate = m[0].replace(/^[^\d+]+|[^\d]+$/g, "");
    const digits = candidate.replace(/\D/g, "").length;
    if (digits < 8 || digits > 15) continue;
    if (NUMBER_RANGE.test(candidate)) continue;
    if (new RegExp(DATE_RANGE.source, "i").test(candidate)) continue;
    return true;
  }
  return false;
}

export function looksLikeCv(text: string): boolean {
  const scan = text.slice(0, MAX_SCAN_CHARS);
  const folded = foldText(scan);
  const lines = scan.split(/\r?\n/).map(cleanLine);
  const headers = headerCount(folded, lines);
  const ranges = folded.match(DATE_RANGE)?.length ?? 0;
  const email = EMAIL.test(scan);
  const phone = hasPhone(scan);

  if (email && phone && scan.length >= 80) return true;
  if (LINKEDIN.test(scan) && (headers >= 1 || ranges >= 1)) return true;
  if (headers >= 3 && (email || phone || ranges >= 1)) return true;
  return headers >= 2 && ranges >= 2;
}

/** Lo que queda en el historial en lugar de un CV pegado: el texto nunca vuelve al modelo. */
export const CV_OMITTED_MARKER = "[La persona pegó un CV; no se incluye]";

/**
 * Primer filtro del mensaje nuevo, ANTES de validar el historial: el CV se detecta sobre el texto
 * completo (aunque pase el tope de largo), así un CV largo se deriva a su flujo en vez de
 * rechazarse como «mensaje muy largo». Después la ruta valida el historial, con el tope de 2.000.
 */
export function screenUserMessage(text: string): Result<void, "cv" | "message_too_long"> {
  if (looksLikeCv(text)) return err("cv");
  if (text.length > AGENT_LIMITS.maxUserMessageChars) return err("message_too_long");
  return ok(undefined);
}

export const CV_REDIRECT_MESSAGE =
  "Parece que pegaste un CV. No lo mandé al asistente ni lo guardé. Por ahora el asistente no lee CVs: cargá tus datos en estas pantallas, o contame en una frase qué querés cambiar (por ejemplo, «tengo 5 años de experiencia»).";

export const CV_REDIRECT_LINKS: readonly AgentLink[] = [
  { href: "/settings/perfil", label: "Tu perfil" },
  { href: "/settings/skills", label: "Tus skills" },
];
