import { err, ok, type Result } from "../result";

export type CvRedactionKind =
  | "email"
  | "phone"
  | "url"
  | "national_id"
  | "passport"
  | "address"
  | "birth_date"
  | "age"
  | "marital_status"
  | "display_name";
export type CvRedaction = { text: string; counts: Partial<Record<CvRedactionKind, number>> };
export type CvRedactError = "redaction_failed";

type Detector = {
  kind: CvRedactionKind;
  marker: string;
  re: RegExp;
  /** Descarta un match que no es del tipo (por ejemplo, un rango de años que parece teléfono). */
  accept?: (match: string) => boolean;
};

const DATE =
  "(?:\\d{1,2}[/.\\-]\\d{1,2}[/.\\-]\\d{2,4}|\\d{4}-\\d{2}-\\d{2}|\\d{1,2}\\s+(?:de\\s+)?\\p{L}+\\s+(?:de\\s+)?\\d{4}|\\p{L}+\\s+\\d{1,2},?\\s+\\d{4}|(?:19|20)\\d{2})";

const YEAR_RE = /^(?:19|20)\d{2}$/;
const digitsOf = (s: string): string => s.replace(/\D/g, "");
/** Rangos de años ("2019-2023", "2018 2019-2021") no son teléfonos. */
const onlyYears = (s: string): boolean => {
  const tokens = s.split(/\D+/).filter(Boolean);
  return tokens.length > 0 && tokens.every((t) => YEAR_RE.test(t));
};

const BASE_DETECTORS: readonly Detector[] = [
  {
    kind: "email",
    marker: "[email]",
    re: /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/gi,
  },
  {
    // Ofuscados: "nombre [at] dominio [dot] com", "nombre (at) dominio.com", "nombre arroba dominio punto com"
    kind: "email",
    marker: "[email]",
    re: /[a-z0-9._%+-]+(?:\s{0,3}[[(]at[\])]\s{0,3}|\s{1,3}arroba\s{1,3})[a-z0-9-]+(?:\s{0,3}(?:[[(]dot[\])]|\.)\s{0,3}[a-z0-9-]+|\s{1,3}punto\s{1,3}[a-z0-9-]+)+/gi,
  },
  {
    kind: "url",
    marker: "[link]",
    re: /(?:\b(?:https?:\/\/|www\.)|\b(?:[a-z0-9-]+\.)+(?:com|net|org|io|dev|app|ar|co|me|ai|info|edu|gov|br|cl|uy|mx|es|us|uk|tech|xyz)\/|\b(?:linkedin|github|gitlab|behance|twitter|instagram|facebook)\.com\b)(?:[^\s,;)\]]*[^\s,;)\].:!?])?/gi,
  },
  {
    kind: "national_id",
    marker: "[documento]",
    re: /\bD\.?\s?N\.?\s?I\.?\s*(?:n[°ºo.]?\s*)?[:#-]?\s*\d{1,2}[. ]?\d{3}[. ]?\d{3}\b/gi,
  },
  {
    kind: "national_id",
    marker: "[documento]",
    re: /\bdocumento(?:\s{1,3}(?:de\s{1,3}identidad|nacional))?\s{0,3}(?:n[°ºo.]?\s{0,3})?[:#-]?\s{0,3}\d{1,2}[. ]?\d{3}[. ]?\d{3}\b/gi,
  },
  {
    kind: "national_id",
    marker: "[documento]",
    re: /\bcu[ií][lt]\s*(?:\/\s*cu[ií][lt]\s*)?[:#-]?\s*\d{2}[- ]?\d{7,8}[- ]?\d\b|\b\d{2}-\d{7,8}-\d\b/gi,
  },
  { kind: "national_id", marker: "[documento]", re: /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g }, // CPF
  { kind: "national_id", marker: "[documento]", re: /\b\d{1,2}\.\d{3}\.\d{3}-[\dkK]\b/g }, // RUT
  {
    kind: "passport",
    marker: "[documento]",
    re: /\b(?:pasaporte|passport)\s*(?:n[°ºo.]?|no\.?|number|num\.?)?\s*[:#-]?\s*(?=[a-z0-9]*\d)[a-z0-9]{6,10}\b/gi,
  },
  {
    kind: "address",
    marker: "[dirección]",
    re: /\b(?:domicilio|direcci[oó]n|address)\s*:\s*[^\n]+/gi,
  },
  {
    kind: "address",
    marker: "[dirección]",
    re: /\b(?:av|avda|avenida|calle|pasaje|pje|bv|boulevard|bulevar|diagonal|camino|street)\b\.?\s+[\p{L}0-9 .'-]{2,40}?\s+(?:n[°ºo.]?\s*)?\d{1,5}\b/giu,
  },
  {
    kind: "birth_date",
    marker: "[fecha de nacimiento]",
    re: new RegExp(
      `\\b(?:fecha\\s+de\\s+nacimiento|f\\.?\\s?de\\s+nac(?:imiento)?\\.?|nacid[oa]\\s+el|nac[ií]\\s+el|date\\s+of\\s+birth|born(?:\\s+on)?|d\\.?o\\.?b\\.?)\\s*[:\\-]?\\s*${DATE}`,
      "giu",
    ),
  },
  {
    kind: "age",
    marker: "[edad]",
    re: /\b(?:edad|age)\s*[:-]?\s*\d{1,2}(?:\s*a(?:ñ|n)os)?\b|\b\d{1,2}\s*a(?:ñ|n)os\s+de\s+edad\b|\b\d{1,2}\s*years?\s*old\b/gi,
  },
  {
    kind: "marital_status",
    marker: "[estado civil]",
    re: /\bestado\s+civil\s*[:-]?\s*\p{L}+(?:\/a|\(a\))?/giu,
  },
  {
    kind: "marital_status",
    marker: "[estado civil]",
    re: /\b(?:solter|casad|divorciad|viud)[oa](?:\/a|\(a\))?(?!\p{L})/giu,
  },
  // Teléfonos al final: internacional, AR con 0/15, 4-4 con separador, 3-3-4 y 10-11 dígitos corridos
  {
    kind: "phone",
    marker: "[teléfono]",
    re: /\+\d[\d\s().-]{7,18}\d/g,
    accept: (m) => digitsOf(m).length >= 9,
  },
  {
    // Formato internacional AR sin "+": 549 + código de área + número
    kind: "phone",
    marker: "[teléfono]",
    re: /\b549[\d\s.-]{8,14}\d\b/g,
    accept: (m) => digitsOf(m).length >= 11,
  },
  {
    kind: "phone",
    marker: "[teléfono]",
    re: /\b0\d{2,4}[\s.-]?(?:15[\s.-]?)?\d{3,4}[\s.-]?\d{3,4}\b|(?:\(?0?\d{2,4}\)?[\s.-]?)?\b\d{4}[\s.-]\d{4}\b|\b\(?\d{2,4}\)?[\s.-]\d{3,4}[\s.-]\d{4}\b|\b\d{10,11}\b/g,
    accept: (m) => !onlyYears(m) && digitsOf(m).length >= 8,
  },
];

const ACCENT_CLASS: Record<string, string> = {
  a: "aáàäâãå",
  e: "eéèëê",
  i: "iíìïî",
  o: "oóòöôõ",
  u: "uúùüû",
  n: "nñ",
  c: "cç",
};

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/** Regex del nombre de la cuenta: sin acentos, insensible a mayúsculas, el nombre completo y cada parte. */
function displayNameDetectors(displayName: string | null | undefined): Detector[] {
  const parts = (displayName ?? "")
    .normalize("NFC")
    .split(/\s+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return [];
  const word = (p: string): string =>
    [...p]
      .map((ch) => {
        const base = ch.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
        const cls = ACCENT_CLASS[base];
        return cls ? `[${cls}]` : escapeRe(ch);
      })
      .join("");
  const lead = "(?<![\\p{L}\\p{N}])";
  const trail = "(?![\\p{L}\\p{N}])";
  const detectors: Detector[] = [];
  if (parts.length > 1) {
    detectors.push({
      kind: "display_name",
      marker: "[nombre]",
      re: new RegExp(`${lead}${parts.map(word).join("\\s+")}${trail}`, "giu"),
    });
  }
  for (const p of parts) {
    if (p.length < 3) continue;
    detectors.push({
      kind: "display_name",
      marker: "[nombre]",
      re: new RegExp(`${lead}${word(p)}${trail}`, "giu"),
    });
  }
  return detectors;
}

const detectorsFor = (displayName?: string | null): Detector[] => [
  ...BASE_DETECTORS,
  ...displayNameDetectors(displayName),
];

/**
 * Tipos de dato personal que todavía hay en el texto. Es el chequeo final de `redactCvText` y lo reusa
 * `normalizeCvExtraction` sobre la salida del modelo. Devuelve tipos, nunca el texto encontrado.
 */
export function findCvSensitive(
  text: string,
  opts?: { displayName?: string | null },
): CvRedactionKind[] {
  const found = new Set<CvRedactionKind>();
  const normalized = text.normalize("NFKC"); // por ejemplo, el "@" de ancho completo
  for (const d of detectorsFor(opts?.displayName)) {
    for (const m of normalized.matchAll(d.re)) {
      if (!d.accept || d.accept(m[0])) {
        found.add(d.kind);
        break;
      }
    }
  }
  return [...found];
}

/** Quita las URLs y dominios con ruta (sin marcador): para sanear texto que devolvió el modelo. */
export function stripCvUrls(text: string): string {
  const url = BASE_DETECTORS.find((d) => d.kind === "url")!;
  return text.replace(url.re, "");
}

/**
 * Saca con reglas, ANTES de cualquier LLM, emails, teléfonos, URLs, documentos, dirección, fecha de
 * nacimiento, edad, estado civil y el nombre de la cuenta. No toca rangos de años ni "5 años de
 * experiencia". FALLA CERRADO: si después de redactar los detectores todavía encuentran algo, devuelve
 * `redaction_failed` en vez de un texto con restos (por ejemplo, un nombre de cuenta que coincide con un
 * marcador, como "Nombre").
 *
 * Residuo conocido: el nombre solo se saca si coincide con `displayName` (otro nombre en el CV, como el
 * de una referencia laboral, queda), y no se detecta un DNI suelto sin etiqueta ("DNI" o "documento").
 * Antes de redactar el texto se normaliza a NFKC, así que el resultado puede diferir en ligaduras y
 * caracteres de ancho completo.
 */
export function redactCvText(
  text: string,
  opts?: { displayName?: string | null },
): Result<CvRedaction, CvRedactError> {
  const counts: Partial<Record<CvRedactionKind, number>> = {};
  let out = text.normalize("NFKC");
  for (const d of detectorsFor(opts?.displayName)) {
    out = out.replace(d.re, (m) => {
      if (d.accept && !d.accept(m)) return m;
      counts[d.kind] = (counts[d.kind] ?? 0) + 1;
      return d.marker;
    });
  }
  if (findCvSensitive(out, opts).length > 0) return err("redaction_failed");
  return ok({ text: out, counts });
}
