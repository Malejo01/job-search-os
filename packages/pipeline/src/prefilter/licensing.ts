import { countriesMentioned, countryNames } from "../normalize/location";
import { foldText } from "../normalize/text";

/**
 * Licencia o matrícula profesional (ronda 107, ADR-022). Un aviso de abogado, enfermería o
 * contaduría pide una habilitación que depende del país: quien no la tiene en el suyo no puede
 * postularse. Determinista y de falla abierta: solo reconoce un conjunto estricto de frases; si el
 * texto nombra el país de la persona cerca de la frase, la licencia es de su país y no descarta.
 *
 * Fuera del conjunto, a propósito: `cpa` y `licensed` sueltos (ruido: «cost per acquisition»,
 * «licensed under the MIT license»), `colegiatura` (en México es la cuota escolar y aparece en
 * beneficios) y «license required» o «must be licensed» cuando es de conducir. `colegiado/a` sí
 * entra: en varios países de la región es la habilitación para ejercer (ingeniería, abogacía).
 */
export type ProfessionalLicense = {
  /** La frase reconocida, ya sin acentos ni mayúsculas. */
  term: string;
  /** Un fragmento del texto alrededor, para mostrar. */
  phrase: string;
  /** El texto nombra el país de la persona junto a la frase: la licencia es de su país. */
  ownCountry: boolean;
  /**
   * La frase aparece como deseable («preferred», «a plus», «deseable», «or equivalent»...), no como
   * requisito: no descarta, solo marca el flag (C-2b).
   */
  preferred: boolean;
};

/** Prefijo del flag del prefiltro: `licencia_profesional:<frase>`. */
export const LICENSE_FLAG = "licencia_profesional";

const LICENSE = "licen[sc]e";
const STRICT: readonly RegExp[] = [
  /\blicen[sc]ed to practice\b/g,
  /\blicen[sc]ed attorney\b/g,
  new RegExp(`\\b(?:professional|state) (?:${LICENSE}s?|licensure)\\b`, "g"),
  /\bbar admission\b/g,
  /\badmitted to the bar\b/g,
  /\badmitted to practice\b/g,
  new RegExp(`\\b(?:rn|nursing|law|medical) ${LICENSE}s?\\b`, "g"),
  /\bregistered nurse\b/g,
  /\bboard certified\b/g,
  /\bcertified public accountant\b/g,
  /\bnmls\b/g,
  /\bseries (?:7|63|65|66)\b/g,
  /\bmatricula (?:profesional|habilitante)\b/g,
  /\bcolegiad[oa]s?\b/g,
  // C-2b (contaduría). «cpa» suelto queda afuera: también es «cost per acquisition».
  /\b(?:licensed|active|current) cpa\b/g,
  /\bcpa (?:license|licensure|required|certification required)\b/g,
  /\bmust (?:be|hold) a(?:n active)? cpa\b/g,
  /\benrolled agent\b/g,
  // El título («Contador Público») no es matrícula: hace falta «matriculado/a».
  /\bcontador(?:a|es)?(?: public[oa]s?)? matriculad[oa]s?\b/g,
];

/** Cómo se llama el organismo de matriculación de un país, además de su nombre (cpce/facpce → AR). */
const COUNTRY_ALIASES: Readonly<Record<string, readonly string[]>> = {
  AR: ["cpce", "facpce"],
};

/** Palabras que vuelven deseable la frase si aparecen hasta 60 caracteres después. */
const PREFERRED_AFTER =
  /\b(?:preferred|a plus|nice to have|desirable|deseable|valorable|en curso|or working toward|or equivalent)\b/;
/** Y hasta 40 caracteres antes. */
const PREFERRED_BEFORE = /\b(?:preferably|preferentemente)\b/;
const SENTENCE_END = /[.;!?\n]/;
/** Países fuera de la región que `countryNames` no cubre (S-2). */
const OTHER_COUNTRY =
  /(?<![a-z0-9])(?:united states|usa|u\.s\.a?|canada|united kingdom|uk|spain|espana|australia|germany|france|india|europe|europa)(?![a-z0-9])/;
const PREFERRED_AFTER_WINDOW = 60;
const PREFERRED_BEFORE_WINDOW = 40;

/** «license required»: cuenta salvo que en las 3 palabras previas sea de conducir. */
const LICENSE_REQUIRED = new RegExp(`\\b${LICENSE} required\\b`, "g");
/** «must be licensed»: cuenta salvo que sea para manejar («must be licensed to drive»). */
const MUST_BE_LICENSED = /\bmust be licen[sc]ed\b/g;
const TO_DRIVE = /^ (?:to drive|to operate a vehicle|driver|driving|para conducir|para manejar)\b/;
const DRIVING = /^(?:driver|drivers|driving|conducir|conductor|manejo)$/;

/** Tope del texto analizado (una JD normal está muy por debajo). */
const MAX_TEXT = 20_000;
/** Tope de coincidencias por frase (costo adversarial). */
const MAX_PER_PATTERN = 50;
/** A cuántos caracteres del match se busca el nombre del país de la persona. */
const COUNTRY_WINDOW = 120;

/** ¿El texto nombra un país de la región distinto del de la persona? */
function otherRegionCountry(foldedText: string, userCountry: string | null): boolean {
  const own = userCountry?.toUpperCase();
  return countriesMentioned(foldedText).some((c) => c !== own);
}

function isDrivingLicense(before: string): boolean {
  const words = before
    .split(/[^a-z0-9']+/)
    .filter(Boolean)
    .slice(-3)
    .map((w) => w.replace(/'s?$|’s?$/, ""));
  return words.some((w) => DRIVING.test(w));
}

/**
 * La licencia o matrícula que exige el aviso, o `null`. Con `userCountry` nulo (país desconocido)
 * no se puede decir que sea el propio: devuelve `ownCountry: false`. Si alguna coincidencia está
 * junto al país de la persona, manda esa (ante la duda, no descarta). `locationRaw` (la ubicación
 * del aviso) que nombra el país de la persona también vuelve propias todas las frases (C-2b). Si no
 * hay ninguna propia, manda la primera excluyente antes que una preferida.
 */
export function detectProfessionalLicense(
  text: string | null,
  userCountry: string | null,
  locationRaw: string | null = null,
): ProfessionalLicense | null {
  if (!text?.trim()) return null;
  // Se conservan los saltos de línea: cortan la ventana de «preferred» (S-1).
  const folded = foldText(text.slice(0, MAX_TEXT))
    .replace(/[^\S\n]+/g, " ")
    .replace(/ ?\n[\s]*/g, "\n");
  const names = userCountry
    ? [...countryNames(userCountry), ...(COUNTRY_ALIASES[userCountry.toUpperCase()] ?? [])]
    : [];
  const nameRe = (n: string) => new RegExp(`(?<![a-z0-9])${n}(?![a-z0-9])`);
  const foldedLocation = locationRaw ? foldText(locationRaw) : "";
  const locationIsOwn = names.some((n) => nameRe(n).test(foldedLocation));

  // 2 = propia, 1 = excluyente de otro país, 0 = preferida de otro país.
  const rank = (l: ProfessionalLicense) => (l.ownCountry ? 2 : l.preferred ? 0 : 1);
  const state: { found: ProfessionalLicense | null } = { found: null };
  const consider = (term: string, index: number, length: number) => {
    const around = folded.slice(
      Math.max(0, index - COUNTRY_WINDOW),
      Math.min(folded.length, index + length + COUNTRY_WINDOW),
    );
    const namesOwn = names.some((n) => nameRe(n).test(around));
    // S-2: la ubicación del aviso solo hace propia la frase si la ventana no nombra otro país.
    const namesOther = OTHER_COUNTRY.test(around) || otherRegionCountry(around, userCountry);
    const ownCountry = namesOwn || (locationIsOwn && !namesOther);
    const end = index + length;
    // S-1: la ventana se corta en el primer fin de oración o de línea.
    const after = folded.slice(end, end + PREFERRED_AFTER_WINDOW).split(SENTENCE_END)[0]!;
    const before = folded
      .slice(Math.max(0, index - PREFERRED_BEFORE_WINDOW), index)
      .split(SENTENCE_END)
      .at(-1)!;
    const preferred = PREFERRED_AFTER.test(after) || PREFERRED_BEFORE.test(before);
    const candidate: ProfessionalLicense = {
      term,
      phrase: folded
        .slice(Math.max(0, index - 40), index + length + 40)
        .replace(/\n/g, " ")
        .trim(),
      ownCountry,
      preferred,
    };
    // La primera coincidencia de mayor rango manda; a igual rango, la primera que se vio.
    if (state.found && rank(candidate) <= rank(state.found)) return;
    state.found = candidate;
  };

  for (const re of STRICT) {
    let seen = 0;
    for (const m of folded.matchAll(re)) {
      if (++seen > MAX_PER_PATTERN) break;
      consider(m[0], m.index!, m[0].length);
    }
  }
  let seen = 0;
  for (const m of folded.matchAll(LICENSE_REQUIRED)) {
    if (++seen > MAX_PER_PATTERN) break;
    if (isDrivingLicense(folded.slice(Math.max(0, m.index! - 60), m.index!))) continue;
    consider(m[0], m.index!, m[0].length);
  }
  seen = 0;
  for (const m of folded.matchAll(MUST_BE_LICENSED)) {
    if (++seen > MAX_PER_PATTERN) break;
    const after = folded.slice(m.index! + m[0].length, m.index! + m[0].length + 30);
    if (TO_DRIVE.test(after)) continue;
    if (isDrivingLicense(folded.slice(Math.max(0, m.index! - 60), m.index!))) continue;
    consider(m[0], m.index!, m[0].length);
  }
  return state.found;
}
