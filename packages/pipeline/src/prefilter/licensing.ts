import { countryNames } from "../normalize/location";
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
];

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
 * junto al país de la persona, manda esa (ante la duda, no descarta).
 */
export function detectProfessionalLicense(
  text: string | null,
  userCountry: string | null,
): ProfessionalLicense | null {
  if (!text?.trim()) return null;
  const folded = foldText(text.slice(0, MAX_TEXT)).replace(/\s+/g, " ");
  const names = userCountry ? countryNames(userCountry) : [];

  const state: { found: ProfessionalLicense | null } = { found: null };
  const consider = (term: string, index: number, length: number) => {
    const around = folded.slice(
      Math.max(0, index - COUNTRY_WINDOW),
      Math.min(folded.length, index + length + COUNTRY_WINDOW),
    );
    const ownCountry = names.some((n) => new RegExp(`(?<![a-z0-9])${n}(?![a-z0-9])`).test(around));
    // La primera coincidencia propia manda; antes de eso, la primera que se vio.
    if (state.found?.ownCountry || (state.found && !ownCountry)) return;
    state.found = {
      term,
      phrase: folded.slice(Math.max(0, index - 40), index + length + 40).trim(),
      ownCountry,
    };
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
