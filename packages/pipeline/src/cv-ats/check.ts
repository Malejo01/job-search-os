/**
 * «¿Tu CV es legible por los filtros (ATS)?» (R14-2). Revisión determinista del texto que ya se extrajo del
 * CV: sin modelo, sin I/O y sin red. Recibe el texto y las skills de la carrera objetivo y devuelve un
 * veredicto con de 3 a 5 puntos concretos (qué falla y cómo arreglarlo).
 *
 * Privacidad: el resultado no copia nada del texto. El email y el teléfono se detectan solo como presentes o
 * ausentes; los únicos nombres que aparecen en los puntos son los de skills del catálogo de la carrera, nunca
 * fragmentos del CV. El llamador tampoco guarda el texto ni el veredicto.
 *
 * Límites (decirlo en la pantalla y en el PR): trabaja sobre el texto extraído, no sobre el archivo. Sin el PDF
 * original no se puede afirmar que haya columnas o tablas: solo se ve si «el texto salió desordenado». No
 * detecta columnas que el extractor devuelve ya en orden de lectura (eso no es un problema), ni texto
 * desordenado sin separaciones largas ni encabezados repetidos en la misma línea.
 */
import { err, ok, type Result } from "../result";

// ---- umbrales (todos con nombre) --------------------------------------------------------------------------------

/** Por debajo de esta cantidad de caracteres visibles no se extrajo texto: es una imagen o un escaneo. */
export const ATS_EMPTY_CHARS = 80;
/** Por debajo de esta cantidad salió texto, pero muy poco para un CV. */
export const ATS_FEW_CHARS = 600;
/** Largo razonable del CV, en palabras: de 150 a 1.200 (más o menos de una a dos páginas). */
export const ATS_WORDS_MIN = 150;
export const ATS_WORDS_MAX = 1200;
/** Más que esto son varias páginas de texto: ya es un problema, no un detalle. */
export const ATS_WORDS_TOO_LONG = 2000;
/** Secciones de las tres que se buscan (experiencia, educación, habilidades). */
export const ATS_SECTIONS_OK = 3;
export const ATS_SECTIONS_FIX = 2;
/** Fechas con mes y año que hacen falta para entender la trayectoria. */
export const ATS_MIN_MONTH_YEAR_DATES = 2;
/** Proporción de líneas con separaciones largas (columnas o tablas) desde la cual el texto se ve desordenado. */
export const ATS_GAP_LINES_FIX = 0.05;
export const ATS_GAP_LINES_BAD = 0.15;
/** Proporción de skills de la carrera que aparecen escritas: desde la primera cifra está bien. */
export const ATS_SKILLS_OK_RATIO = 0.4;
export const ATS_SKILLS_FIX_RATIO = 0.15;
/** Puntaje: «a corregir» suma 1 y «grave» suma 2; con este total o más es «Difícil de leer». */
export const ATS_SCORE_DIFFICULT = 4;
/** Tope del texto que se revisa: protege al navegador de un pegado enorme. */
export const ATS_MAX_INPUT_CHARS = 200_000;
/** Puntos que se devuelven. */
export const ATS_MIN_POINTS = 3;
export const ATS_MAX_POINTS = 5;
/** Una línea más larga que esto no se mira como título de sección. */
const ATS_MAX_TITLE_LINE_CHARS = 200;
/** Skills faltantes que se nombran como mucho. */
const ATS_MAX_NAMED_SKILLS = 5;

// ---- tipos -------------------------------------------------------------------------------------------------------

export type AtsVerdict = "legible" | "legible_con_arreglos" | "dificil";
export type AtsStatus = "ok" | "fix" | "bad";
export type AtsCheckId =
  | "texto"
  | "texto_prueba"
  | "texto_exportar"
  | "secciones"
  | "fechas"
  | "orden"
  | "largo"
  | "contacto"
  | "skills";

export interface AtsPoint {
  id: AtsCheckId;
  status: AtsStatus;
  /** Qué pasa (o qué está bien). */
  what: string;
  /** Cómo arreglarlo; `null` si no hace falta. */
  how: string | null;
}

export interface AtsReport {
  verdict: AtsVerdict;
  label: string;
  /** De 3 a 5 puntos, primero lo más grave. */
  points: AtsPoint[];
}

export type AtsError = "texto_no_valido" | "texto_demasiado_largo";

export interface AtsSkill {
  name: string;
  aliases?: readonly string[];
}

export const ATS_VERDICT_LABELS: Record<AtsVerdict, string> = {
  legible: "Legible",
  legible_con_arreglos: "Legible con arreglos",
  dificil: "Difícil de leer",
};

/** Pregunta y aviso de la pantalla. Nunca promete que un CV «pase» filtros ni que consiga entrevistas. */
export const ATS_TITLE = "¿Tu CV es legible por los filtros (ATS)?";
export const ATS_DISCLAIMER =
  "Es una revisión automática de si el texto de tu CV es legible por los filtros. Cada empresa usa su propio sistema: esto no garantiza nada.";

// ---- utilidades --------------------------------------------------------------------------------------------------

const fold = (t: string): string => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const escapeRe = (t: string): string => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const words = (t: string): number => (t.match(/\S+/g) ?? []).length;

// ---- chequeos ----------------------------------------------------------------------------------------------------

const SECTION_PATTERNS: Record<"experiencia" | "educacion" | "habilidades", RegExp> = {
  experiencia:
    /^(experiencia( laboral| profesional)?|trayectoria( laboral| profesional)?|antecedentes laborales|work experience|experience|employment( history)?)$/,
  educacion:
    /^(educacion|formacion( academica)?|estudios( realizados)?|education|academic background)$/,
  habilidades:
    /^(habilidades( tecnicas| blandas)?|skills|competencias( tecnicas)?|conocimientos( tecnicos)?|tecnologias|aptitudes|herramientas)$/,
};

/** Un título de sección es una línea corta, sola, con o sin «:» al final. */
function sectionTitle(line: string): keyof typeof SECTION_PATTERNS | null {
  // Un título es corto: una línea larga no lo es, y recortarla con la regex de abajo sería cuadrático
  if (line.length > ATS_MAX_TITLE_LINE_CHARS) return null;
  const t = fold(line)
    .replace(/[:.\s]+$/, "")
    .trim();
  if (t.length === 0 || t.length > 40) return null;
  for (const [key, re] of Object.entries(SECTION_PATTERNS)) {
    if (re.test(t)) return key as keyof typeof SECTION_PATTERNS;
  }
  return null;
}

function countSections(lines: readonly string[]): number {
  const found = new Set<string>();
  for (const l of lines) {
    const k = sectionTitle(l);
    if (k) found.add(k);
  }
  return found.size;
}

const MONTHS =
  "ene|feb|mar|abr|may|jun|jul|ago|sep|sept|set|oct|nov|dic|jan|apr|aug|dec|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre|january|february|march|april|june|july|august|september|october|november|december";
const MONTH_YEAR_RES: RegExp[] = [
  new RegExp(`\\b(${MONTHS})\\.?,?\\s+(de\\s+)?(19|20)\\d{2}\\b`, "g"),
  /\b(0?[1-9]|1[0-2])\s?[/.-]\s?(19|20)\d{2}\b/g,
  /\b(19|20)\d{2}\s?[/.-]\s?(0[1-9]|1[0-2])\b/g,
];
const YEAR_RE = /\b(19|20)\d{2}\b/g;

function countMonthYear(folded: string): number {
  return MONTH_YEAR_RES.reduce((n, re) => n + (folded.match(re)?.length ?? 0), 0);
}

const GAP_RE = /\S(?: {3,}|\t+)\S/;

/** Líneas con una separación larga en el medio: lo que deja una tabla o dos columnas pegadas por el extractor. */
function gapLineShare(lines: readonly string[]): number {
  const filled = lines.filter((l) => l.trim() !== "");
  if (filled.length === 0) return 0;
  const gaps = filled.filter((l) => GAP_RE.test(l.trim()) || (l.match(/\|/g)?.length ?? 0) >= 2);
  return gaps.length / filled.length;
}

/** Dos títulos de sección en la misma línea: columnas lado a lado leídas como una sola. */
function hasTwoTitlesInOneLine(lines: readonly string[]): boolean {
  return lines.some((l) => {
    const parts = l.split(/ {3,}|\t+|\|/).filter((p) => p.trim() !== "");
    return parts.length >= 2 && parts.filter((p) => sectionTitle(p) !== null).length >= 2;
  });
}

// El inicio va anclado al comienzo del token: sin eso, un texto largo sin espacios prueba desde cada posición
const EMAIL_RE = /(?<![^\s@])[^\s@]+@[^\s@]+\.[a-z]{2,}/i;

function hasPhone(text: string): boolean {
  for (const m of text.matchAll(/\+?\d[\d\s().-]{6,}\d/g)) {
    const groups = m[0].split(/\D+/).filter((g) => g !== "");
    const digits = groups.join("").length;
    if (digits < 8 || digits > 15) continue;
    // «2019 - 2022» o «01.2020 - 03.2021» son años y meses, no un teléfono
    if (groups.every((g) => /^((19|20)\d{2}|0?[1-9]|1[0-2])$/.test(g))) continue;
    return true;
  }
  return false;
}

function skillsFound(
  folded: string,
  skills: readonly AtsSkill[],
): { found: number; missing: string[] } {
  const missing: string[] = [];
  let found = 0;
  for (const s of skills) {
    const names = [s.name, ...(s.aliases ?? [])].map(fold).filter((n) => n.trim() !== "");
    const hit = names.some((n) =>
      new RegExp(`(?<![a-z0-9])${escapeRe(n)}(?![a-z0-9])`).test(folded),
    );
    if (hit) found++;
    else missing.push(s.name);
  }
  return { found, missing };
}

// ---- revisión ----------------------------------------------------------------------------------------------------

const STATUS_ORDER: Record<AtsStatus, number> = { bad: 0, fix: 1, ok: 2 };
const STATUS_SCORE: Record<AtsStatus, number> = { bad: 2, fix: 1, ok: 0 };

function report(verdict: AtsVerdict, points: AtsPoint[]): AtsReport {
  return { verdict, label: ATS_VERDICT_LABELS[verdict], points };
}

/**
 * Revisa el texto extraído del CV. `careerSkills` son las skills de la carrera objetivo (vacío = no se revisan).
 * Devuelve `Err` solo si la entrada no es un texto usable; un texto vacío es un resultado válido («Difícil de leer»).
 */
export function checkCvAts(
  text: string,
  careerSkills: readonly AtsSkill[] = [],
): Result<AtsReport, AtsError> {
  if (typeof text !== "string") return err("texto_no_valido");
  if (text.length > ATS_MAX_INPUT_CHARS) return err("texto_demasiado_largo");

  const visible = text.replace(/\s+/g, "").length;
  if (visible < ATS_EMPTY_CHARS) {
    return ok(
      report("dificil", [
        {
          id: "texto",
          status: "bad",
          what: "No se pudo extraer texto de tu CV: parece una imagen o un escaneo, y un filtro automático no puede leer una imagen.",
          how: "Exportalo de nuevo como PDF con texto desde Word o Google Docs, no como foto ni como escaneo.",
        },
        {
          id: "texto_prueba",
          status: "bad",
          what: "Una forma de comprobarlo: abrí tu PDF y probá seleccionar una frase con el cursor.",
          how: "Si no se puede seleccionar, es una imagen. Si se puede y igual no salió texto, probá pegar el texto a mano.",
        },
        {
          id: "texto_exportar",
          status: "bad",
          what: "Mientras no haya texto, no se puede revisar nada más de tu CV.",
          how: "Cuando tengas el PDF con texto, volvé a subirlo o pegá el texto acá para revisarlo de nuevo.",
        },
      ]),
    );
  }

  const folded = fold(text);
  const lines = text.split(/\r?\n/);
  const wordCount = words(text);
  const checks: AtsPoint[] = [];

  // texto: poco texto
  if (visible < ATS_FEW_CHARS) {
    checks.push({
      id: "texto",
      status: "fix",
      what: "Salió muy poco texto para un CV: puede que parte esté en imágenes o en cuadros que no se leen.",
      how: "Revisá que nombre, experiencia y estudios estén como texto normal y no dentro de imágenes.",
    });
  } else {
    checks.push({
      id: "texto",
      status: "ok",
      what: "Se pudo extraer el texto de tu CV.",
      how: null,
    });
  }

  // secciones
  const sections = countSections(lines);
  if (sections >= ATS_SECTIONS_OK) {
    checks.push({
      id: "secciones",
      status: "ok",
      what: "Están los títulos habituales: Experiencia, Educación y Habilidades.",
      how: null,
    });
  } else {
    checks.push({
      id: "secciones",
      status: sections >= ATS_SECTIONS_FIX ? "fix" : "bad",
      what: `Encontramos ${sections} de los 3 títulos habituales (Experiencia, Educación, Habilidades).`,
      how: "Usá esos títulos tal cual, cada uno en su propia línea. Los filtros se guían por ellos para ordenar tu CV.",
    });
  }

  // fechas
  const monthYear = countMonthYear(folded);
  if (monthYear >= ATS_MIN_MONTH_YEAR_DATES) {
    checks.push({
      id: "fechas",
      status: "ok",
      what: "Las fechas están con mes y año.",
      how: null,
    });
  } else {
    const years = folded.match(YEAR_RE)?.length ?? 0;
    checks.push({
      id: "fechas",
      status: years >= 2 ? "fix" : "bad",
      what:
        years >= 2
          ? "Las fechas aparecen solo con el año: hace falta el mes para entender cuánto duró cada trabajo."
          : "No encontramos fechas de trabajos o estudios.",
      how: "Escribí cada período como «03/2021 - 08/2023» o «marzo 2021 - agosto 2023», y «actual» si seguís ahí.",
    });
  }

  // orden del texto
  const gapShare = gapLineShare(lines);
  if (hasTwoTitlesInOneLine(lines) || gapShare >= ATS_GAP_LINES_BAD) {
    checks.push({
      id: "orden",
      status: "bad",
      what: "El texto salió desordenado: hay títulos y frases de distintos bloques mezclados en la misma línea. Suele pasar con columnas o tablas.",
      how: "Rehacelo en una sola columna, sin tablas ni cuadros de texto, y volvé a exportar.",
    });
  } else if (gapShare >= ATS_GAP_LINES_FIX) {
    checks.push({
      id: "orden",
      status: "fix",
      what: "Parte del texto salió con separaciones largas en el medio de la línea, como si hubiera columnas o una tabla.",
      how: "Si usás columnas o una tabla, pasá todo a una sola columna y volvé a exportar.",
    });
  } else {
    checks.push({
      id: "orden",
      status: "ok",
      what: "El texto salió en un orden de lectura normal.",
      how: null,
    });
  }

  // largo
  if (wordCount > ATS_WORDS_TOO_LONG) {
    checks.push({
      id: "largo",
      status: "fix",
      what: "Tu CV es muy largo: tiene varias páginas de texto.",
      how: "Dejalo en una o dos páginas con lo más reciente y lo más relevante para el puesto.",
    });
  } else if (wordCount > ATS_WORDS_MAX) {
    checks.push({
      id: "largo",
      status: "fix",
      what: "Tu CV pasa las dos páginas de texto.",
      how: "Resumí los trabajos más viejos y dejá lo más relevante para el puesto.",
    });
  } else if (wordCount < ATS_WORDS_MIN) {
    checks.push({
      id: "largo",
      status: "fix",
      what: "Tu CV es muy corto: le falta contenido para que un filtro lo entienda.",
      how: "Sumá una línea por trabajo y por estudio, con lo que hiciste y las herramientas que usaste.",
    });
  } else {
    checks.push({ id: "largo", status: "ok", what: "El largo es razonable.", how: null });
  }

  // email y teléfono: solo se sabe si están; no se copian a ningún lado
  const email = EMAIL_RE.test(text);
  const phone = hasPhone(text);
  if (email && phone) {
    checks.push({
      id: "contacto",
      status: "ok",
      what: "Hay un email y un teléfono de contacto.",
      how: null,
    });
  } else {
    const missing = [email ? null : "un email", phone ? null : "un teléfono"].filter(Boolean);
    checks.push({
      id: "contacto",
      status: "fix",
      what: `No encontramos ${missing.join(" ni ")} de contacto en el texto.`,
      how: "Poné el email y el teléfono arriba, como texto normal y no dentro de un ícono o una imagen. Esto no se guarda.",
    });
  }

  // skills de la carrera objetivo
  if (careerSkills.length > 0) {
    const { found, missing } = skillsFound(folded, careerSkills);
    const ratio = found / careerSkills.length;
    if (ratio >= ATS_SKILLS_OK_RATIO) {
      checks.push({
        id: "skills",
        status: "ok",
        what: `Aparecen escritas ${found} de las ${careerSkills.length} habilidades habituales de tu carrera.`,
        how: null,
      });
    } else {
      const named = missing.slice(0, ATS_MAX_NAMED_SKILLS).join(", ");
      checks.push({
        id: "skills",
        status: ratio >= ATS_SKILLS_FIX_RATIO ? "fix" : "bad",
        what: `Aparecen escritas ${found} de las ${careerSkills.length} habilidades habituales de tu carrera. Faltan, por ejemplo: ${named}.`,
        how: "Si las usás, escribilas con ese nombre en tu sección de habilidades. Solo las que de verdad manejás.",
      });
    }
  }

  const score = checks.reduce((n, c) => n + STATUS_SCORE[c.status], 0);
  const verdict: AtsVerdict =
    score >= ATS_SCORE_DIFFICULT ? "dificil" : score > 0 ? "legible_con_arreglos" : "legible";

  // De 3 a 5 puntos: primero lo grave, después lo que hay que corregir; si faltan, lo que está bien
  const ordered = [...checks]
    .map((c, i) => ({ c, i }))
    .sort((a, b) => STATUS_ORDER[a.c.status] - STATUS_ORDER[b.c.status] || a.i - b.i)
    .map((x) => x.c);
  const problems = ordered.filter((c) => c.status !== "ok");
  const oks = ordered.filter((c) => c.status === "ok");
  const points = [
    ...problems,
    ...oks.slice(0, Math.max(0, ATS_MIN_POINTS - problems.length)),
  ].slice(0, ATS_MAX_POINTS);
  return ok(report(verdict, points));
}
