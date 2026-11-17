/**
 * Filtro de datos sensibles del agente de perfil (ADR-034). Puro. Edad, estado civil, hijos, salud,
 * religión, política, DNI y domicilio NUNCA pasan a una tarjeta ni al perfil, vengan del CV, del modelo
 * o de lo que la persona escribe en la charla. Devuelve TIPOS, nunca el texto encontrado.
 *
 * Es conservador a propósito, pero acotado: un patrón que solo mira una palabra suelta («católica»,
 * «hospital», «discapacidad») descartaría una universidad, un empleador o una tarea laboral legítima.
 * Por eso lo de religión, política y salud exige una etiqueta («Religión:») o una frase en primera
 * persona («soy católico», «tengo diabetes»). El residuo conocido (un dato sensible dicho de otra manera)
 * lo cubre la regla de producto: nada se guarda sin el clic de la persona sobre la tarjeta.
 */
import { findCvSensitive } from "../cv/redact";
import { foldText } from "../normalize/text";

export const PROFILE_SENSITIVE_KINDS = [
  "age",
  "marital_status",
  "children",
  "health",
  "religion",
  "politics",
  "national_id",
  "address",
  "contact",
] as const;
export type ProfileSensitiveKind = (typeof PROFILE_SENSITIVE_KINDS)[number];

// Invisibles que partirían una frase para esquivar los patrones (sin escribirlos en el fuente)
const INVISIBLE_RE = new RegExp(
  "[\\u00ad\\u200b-\\u200f\\u202a-\\u202e\\u2060-\\u2064\\u2066-\\u2069\\ufeff]|[\\u{e0000}-\\u{e007f}]",
  "gu",
);

type Pattern = { kind: ProfileSensitiveKind; re: RegExp };

/** Sobre texto plegado (minúsculas, sin acentos). */
const PATTERNS: readonly Pattern[] = [
  // Edad y nacimiento. «tengo 5 años de experiencia» NO es edad.
  {
    kind: "age",
    re: /\btengo\s+\d{1,2}\s+anos\b(?!\s+de\s+(?:experiencia|trayectoria|antiguedad|carrera|servicio))/,
  },
  // «nací el 3 de…», «nacido el 03/…», «nacida en 1990». «Nací en Rosario» (lugar) no es fecha.
  {
    kind: "age",
    re: /\b(?:nacid[oa]|naci)\s+(?:el|en)\s+(?:el\s+)?(?:\d{1,2}\b|(?:19|20)\d{2}\b)/,
  },
  { kind: "age", re: /\bfecha\s+de\s+nacimiento\b|\bdate\s+of\s+birth\b/ },
  { kind: "age", re: /\bborn\s+(?:in|on)\s+(?:\w+\s+){0,2}(?:19|20)\d{2}\b/ },
  { kind: "age", re: /\bi\s*(?:am|'m)\s+\d{1,2}\s+years?\s+old\b/ },

  // Hijos y familia. «nodos hijos» o «componentes hijos» no coinciden: el número va pegado a «hijos».
  { kind: "children", re: /\bhij[oa]s?\s*[:-]\s*\d/ },
  { kind: "children", re: /\b(?:\d{1,2}|un|una|dos|tres|cuatro|cinco)\s+hij[oa]s?\b/ },
  { kind: "children", re: /\btengo\s+(?:\w+\s+){0,2}hij[oa]s?\b/ },
  { kind: "children", re: /\b(?:padre|madre)\s+de\s+(?:familia|\d{1,2}|un|una|dos|tres|cuatro)\b/ },
  { kind: "children", re: /\b(?:con|sin)\s+hij[oa]s\b/ },
  { kind: "children", re: /\bhij[oa]s?\s+a\s+cargo\b/ },
  { kind: "children", re: /\bnumero\s+de\s+hij[oa]s\b/ },
  { kind: "children", re: /\bembarazad[oa]\b|\bestoy\s+embarazada\b/ },
  {
    kind: "children",
    re: /\bi\s+have\s+(?:\w+\s+){0,2}(?:kids|children|daughters?|sons?)\b|\b(?:number\s+of\s+)?children\s*:\s*\d/,
  },

  // Salud: etiqueta o primera persona. Trabajar CON personas con discapacidad no es un dato de salud.
  { kind: "health", re: /\bestado\s+de\s+salud\b/ },
  { kind: "health", re: /\bsalud\s*:\s*\p{L}/u },
  {
    kind: "health",
    re: /\b(?:discapacidad|enfermedad|condicion\s+medica|tratamiento\s+medico|diagnostico|alergias?)\s*:/,
  },
  { kind: "health", re: /\bcertificado\s+(?:unico\s+)?de\s+discapacidad\b|\bcud\s*:/ },
  {
    kind: "health",
    re: /\b(?:tengo|padezco|sufro(?:\s+de)?|poseo)\s+(?:\w+\s+){0,3}(?:discapacidad|enfermedad|diabetes|cancer|asma|epilepsia|hipertension|depresion|ansiedad|trastorno|hiv|vih)\b/,
  },
  {
    kind: "health",
    re: /\b(?:disability|medical\s+condition|health\s+status)\s*:|\bi\s+(?:have|suffer\s+from)\s+(?:\w+\s+){0,2}(?:disability|illness|diabetes|cancer|depression|anxiety)\b/,
  },

  // Religión
  { kind: "religion", re: /\b(?:religion|credo|culto|creencia\s+religiosa|confesion)\s*:/ },
  { kind: "religion", re: /\bmi\s+(?:religion|fe)\b|\bde\s+religion\s+\p{L}+/u },
  {
    kind: "religion",
    re: /\b(?:soy|me\s+considero|profeso)\s+(?:\w+\s+){0,2}(?:catolic[oa]|judi[oa]|musulman[a]?|evangelic[oa]|protestante|budista|hindu|ateo|atea|mormon|cristian[oa]|agnostic[oa]|testigo\s+de\s+jehova)\b/,
  },
  { kind: "religion", re: /\bpractic(?:o|ante)\s+(?:la\s+)?(?:fe|religion)\b/ },
  {
    kind: "religion",
    re: /\bi\s+am\s+(?:a\s+)?(?:catholic|muslim|jewish|christian|buddhist|hindu|atheist|agnostic)\b/,
  },

  // Política
  { kind: "politics", re: /\b(?:afiliacion|filiacion)\s+politic[ao]\b/ },
  {
    kind: "politics",
    re: /\bafiliad[oa]\s+(?:al?|del?)\s+(?:partido|pj|ucr|pro|frente|juventud)\b/,
  },
  { kind: "politics", re: /\b(?:ideologia|orientacion|postura|posicion)\s+politic[ao]\b/ },
  {
    kind: "politics",
    re: /\bmilitante\b|\bmilito\s+en\s+(?:el\s+)?(?:partido|juventud|ucr|pj|pro|frente)\b/,
  },
  {
    kind: "politics",
    re: /\bpartido\s+politico\s*:|\bsimpatizante\s+(?:del?|al)\s+(?:partido|pj|ucr|pro)\b/,
  },
  {
    kind: "politics",
    re: /\bpolitical\s+(?:affiliation|party|views|orientation)\b|\bmember\s+of\s+the\s+\w+\s+party\b/,
  },

  // Documento y domicilio con etiqueta (los de formato fijo los cubre `findCvSensitive`)
  {
    kind: "national_id",
    re: /\b(?:dni|cedula(?:\s+de\s+identidad)?|cuil|cuit|rut|cpf|curp|nif|nie)\s*(?:n[o°º.]?\s*)?[:#-]?\s*\d[\d.\-\s]{5,}/,
  },
  { kind: "address", re: /\bcodigo\s+postal\s*[:-]?\s*\d|\bcp\s*:\s*[a-z]?\d{4}/ },
];

const CV_KIND_TO_PROFILE: Partial<Record<string, ProfileSensitiveKind>> = {
  age: "age",
  birth_date: "age",
  marital_status: "marital_status",
  national_id: "national_id",
  passport: "national_id",
  address: "address",
  email: "contact",
  phone: "contact",
};

/** Tipos de dato sensible que hay en el texto. Vacío si no hay ninguno. Nunca devuelve el texto. */
export function findProfileSensitive(text: string): ProfileSensitiveKind[] {
  const clean = text.normalize("NFKC").replace(INVISIBLE_RE, "");
  const found = new Set<ProfileSensitiveKind>();
  for (const k of findCvSensitive(clean)) {
    const mapped = CV_KIND_TO_PROFILE[k];
    if (mapped) found.add(mapped);
  }
  const folded = foldText(clean);
  for (const p of PATTERNS) {
    if (!found.has(p.kind) && p.re.test(folded)) found.add(p.kind);
  }
  return PROFILE_SENSITIVE_KINDS.filter((k) => found.has(k));
}

export function hasProfileSensitive(text: string): boolean {
  return findProfileSensitive(text).length > 0;
}
