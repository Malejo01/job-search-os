import { countriesMentioned, mentionsCountry } from "../normalize/location";
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

const US_STATES = [
  "alabama",
  "alaska",
  "arizona",
  "arkansas",
  "california",
  "colorado",
  "connecticut",
  "delaware",
  "florida",
  "georgia",
  "hawaii",
  "idaho",
  "illinois",
  "indiana",
  "iowa",
  "kansas",
  "kentucky",
  "louisiana",
  "maine",
  "maryland",
  "massachusetts",
  "michigan",
  "minnesota",
  "mississippi",
  "missouri",
  "montana",
  "nebraska",
  "nevada",
  "new hampshire",
  "new jersey",
  "new mexico",
  "new york",
  "north carolina",
  "north dakota",
  "ohio",
  "oklahoma",
  "oregon",
  "pennsylvania",
  "rhode island",
  "south carolina",
  "south dakota",
  "tennessee",
  "texas",
  "utah",
  "vermont",
  "virginia",
  "washington",
  "west virginia",
  "wisconsin",
  "wyoming",
];
/** Lista cerrada de lugares para «licensed in <lugar>» (T1). */
const LICENSED_IN_PLACES = [
  ...US_STATES,
  "the us",
  "the usa",
  "the united states",
  "any state",
  "the state of",
  "canada",
  "the uk",
  "uk",
  "reino unido",
  "spain",
  "mexico",
  "brazil",
  "colombia",
  "chile",
  "peru",
  "argentina",
];

/** Palabras que vuelven la frase de software, de código abierto o de conducir (3 palabras alrededor). */
const NOT_PROFESSIONAL = /\b(?:software|mit|apache|gpl|bsd|open source|driver|drivers|driving)\b/;
/** Para «must hold … license»: también cuenta lo que haya dentro de la frase. */
const NOT_PROFESSIONAL_MUST =
  /\b(?:driver|drivers|driving|software|api|key|keys|conducir|manejar)\b/;
const PROFESSION_ES =
  /\b(?:contador(?:a|es|as)?|abogad[oa]s?|enfermer[oa]s?|ingenier[oa]s?|arquitect[oa]s?|medic[oa]s?|psicolog[oa]s?)\b/;

type Extra = {
  re: RegExp;
  /** Busca en el texto con mayúsculas (siglas); si el largo no coincide con el plegado, se omite. */
  cased?: boolean;
  /** Hace falta este contexto a `window` caracteres de la coincidencia (en el texto plegado). */
  ctx?: { re: RegExp; window: number };
  /** Descarta la coincidencia (falso positivo). */
  skip?: (folded: string, index: number, length: number) => boolean;
};

/** T1-S-2: quien habla es la empresa, no un requisito para la persona. */
const SUBJECT_WORDS = /^(?:our|we|company|network|team|platform|partners)$/;
/** T1-S-2: verbo de requisito que hace falta cerca de «licensed <profesión>». */
const REQUIREMENT =
  /\b(?:must|required|requires?|requiere|requirements?|need|needs|debe|requisito)\b/;
/** T1-S-3: conducir o vehículo después de «must have … license» (en la misma oración). */
const VEHICLE_AFTER = /\b(?:vehicle|car|transportation|driver|driving|licencia de conducir)\b/;

/** T1-S-2: ¿«licensed in/<profesión>» lo dice la empresa de sí misma («we are licensed in …»)? */
function companySubject(folded: string, index: number): boolean {
  const words = folded
    .slice(Math.max(0, index - 40), index)
    .split(/[^a-z0-9']+/)
    .filter(Boolean)
    .slice(-3);
  return (
    words.some((w) => SUBJECT_WORDS.test(w)) ||
    /\b(?:is|are) $/.test(folded.slice(Math.max(0, index - 5), index))
  );
}

function wordsAround(folded: string, index: number, length: number): string {
  const before = folded
    .slice(Math.max(0, index - 40), index)
    .split(/[^a-z0-9']+/)
    .filter(Boolean)
    .slice(-3);
  const after = folded
    .slice(index + length, index + length + 40)
    .split(/[^a-z0-9']+/)
    .filter(Boolean)
    .slice(0, 3);
  return [...before, ...after].join(" ");
}

/**
 * Patrones de la ronda T1: sin cuantificadores anidados, todos acotados. Van después de STRICT: a
 * igual rango manda la primera frase vista, así los términos históricos no cambian.
 */
const EXTRA: readonly Extra[] = [
  // 1. «licensed in <lugar>», salvo software, código abierto o conducir a 3 palabras.
  {
    re: new RegExp(`\\blicen[sc]ed in (?:${LICENSED_IN_PLACES.join("|")})(?![a-z])`, "g"),
    skip: (f, i, l) => NOT_PROFESSIONAL.test(wordsAround(f, i, l)) || companySubject(f, i),
  },
  // 2. «must hold an active … license»: hasta 3 palabras en el medio.
  {
    re: new RegExp(
      `\\bmust (?:hold|have|possess|maintain|obtain) an? (?:(?:valid|active|current) )?(?:[a-z']+ ){0,3}${LICENSE}\\b`,
      "g",
    ),
    skip: (f, i, l) =>
      NOT_PROFESSIONAL_MUST.test(f.slice(i, i + l)) ||
      /^ (?:key|keys|agreement|server|api)\b/.test(f.slice(i + l, i + l + 12)) ||
      TO_DRIVE.test(f.slice(i + l, i + l + 30)) ||
      VEHICLE_AFTER.test(f.slice(i + l, i + l + 30).split(SENTENCE_END)[0]!),
  },
  // 3. «licensed <profesión>» («attorney» ya está en STRICT).
  {
    re: /\blicen[sc]ed (?:physicians?|therapists?|pharmacists?|electricians?|engineers?|architects?|real estate|insurance|social workers?|counsel(?:l)?ors?|lawyers?)\b/g,
    // Sin sujeto de empresa y con un verbo de requisito a ±40 caracteres, o no descarta.
    skip: (f, i, l) =>
      companySubject(f, i) || !REQUIREMENT.test(f.slice(Math.max(0, i - 40), i + l + 40)),
  },
  // 4. Ingeniería (PE): la sigla, solo con «license» o «stamp»; «professional engineer» con contexto.
  { re: /\b(?:pe|p\.e\.) (?:licen[sc]e|stamp)\b/g },
  {
    re: /\bprofessional engineers?\b/g,
    ctx: { re: /\b(?:licen[sc]e[ds]?|licensure|stamp|registered)\b/, window: 20 },
  },
  // 5. Enfermería: siglas en mayúsculas, con contexto.
  // T1-S-1: «RN» también es React Native: sin «required» y salteando «react»/«native» a ±30.
  {
    re: /\bRN\b/g,
    cased: true,
    ctx: { re: /\b(?:licen[sc]e[ds]?|licensure|nclex|lpn)\b/, window: 20 },
    skip: (f, i, l) => /\b(?:react|native)\b/.test(f.slice(Math.max(0, i - 30), i + l + 30)),
  },
  {
    re: /\b(?:LPN|NCLEX)\b/g,
    cased: true,
    ctx: { re: /\b(?:licen[sc]e[ds]?|licensure|required)\b/, window: 20 },
  },
  // 6. Derecho.
  { re: /\bbar exam\b/g },
  { re: /\bmember of the bar\b/g },
  { re: /\bjuris doctor\b/g },
  // 7. Español: con una profesión a ±60 caracteres («matrícula» escolar no cuenta).
  {
    re: /\b(?:matricula vigente|tarjeta profesional|cedula profesional|matriculad[oa]s?)\b/g,
    ctx: { re: PROFESSION_ES, window: 60 },
  },
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
  /(?<![a-z0-9])(?:united states|usa|u\.s\.a?|new mexico|nuevo mexico|canada|united kingdom|uk|spain|espana|australia|germany|france|india|europe|europa)(?![a-z0-9])/;
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
/** Tope de iteraciones por patrón nuevo, aunque la coincidencia se descarte (costo). */
const MAX_ITERATIONS = 200;
/*
 * T1-S-5: estas reglas son heurísticas de falla abierta, sin medición con carreras reguladas: los
 * lugares, profesiones y ventanas son una lista cerrada que se ajusta con datos reales.
 */
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
  const tidy = (s: string) => s.replace(/[^\S\n]+/g, " ").replace(/ ?\n[\s]*/g, "\n");
  const folded = tidy(foldText(text.slice(0, MAX_TEXT)));
  // Igual que `folded` pero con mayúsculas, para las siglas (RN, LPN, NCLEX).
  const cased = tidy(text.slice(0, MAX_TEXT).normalize("NFKD").replace(/[̀-ͯ]/g, ""));
  const aliases = userCountry ? (COUNTRY_ALIASES[userCountry.toUpperCase()] ?? []) : [];
  const nameRe = (n: string) => new RegExp(`(?<![a-z0-9])${n}(?![a-z0-9])`);
  // El nombre del país con el mismo regex que el prefiltro ("New Mexico" no es MX, JS-111).
  const namesOwnCountry = (t: string) =>
    (userCountry !== null && mentionsCountry(t, userCountry)) ||
    aliases.some((n) => nameRe(n).test(t));
  const foldedLocation = locationRaw ? foldText(locationRaw) : "";
  const locationIsOwn = namesOwnCountry(foldedLocation);

  // 2 = propia, 1 = excluyente de otro país, 0 = preferida de otro país.
  const rank = (l: ProfessionalLicense) => (l.ownCountry ? 2 : l.preferred ? 0 : 1);
  const state: { found: ProfessionalLicense | null } = { found: null };
  const consider = (term: string, index: number, length: number) => {
    const around = folded.slice(
      Math.max(0, index - COUNTRY_WINDOW),
      Math.min(folded.length, index + length + COUNTRY_WINDOW),
    );
    const namesOwn = namesOwnCountry(around);
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
  for (const x of EXTRA) {
    if (x.cased && cased.length !== folded.length) continue;
    let n = 0;
    let iterations = 0;
    for (const m of (x.cased ? cased : folded).matchAll(x.re)) {
      // T1-S-4: el tope de costo cuenta iteraciones; el de 50, solo lo que pasó skip y ctx.
      if (++iterations > MAX_ITERATIONS) break;
      const index = m.index!;
      const length = m[0].length;
      if (x.skip?.(folded, index, length)) continue;
      if (x.ctx) {
        const w = x.ctx.window;
        const near = `${folded.slice(Math.max(0, index - w), index)} ${folded.slice(index + length, index + length + w)}`;
        if (!x.ctx.re.test(near)) continue;
      }
      if (++n > MAX_PER_PATTERN) break;
      consider(folded.slice(index, index + length), index, length);
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
