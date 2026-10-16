import { countryNames } from "../normalize/location";
import { foldText } from "../normalize/text";

/**
 * Dónde se puede trabajar un aviso del pool, a partir de `countries_allowed` y del texto de la
 * ubicación (ronda 51). Determinista y conservador: solo reconoce países y regiones por palabra
 * entera; lo que no entiende queda `unknown` y sigue llegando con el `location_risk` de hoy.
 * Solo lo usa el pool: `prefilter.ts` y la ingesta por email no cambian. La exclusión
 * ("LATAM except Argentina") no se interpreta: falla abierto.
 */

export type Region = "LATAM" | "AMERICAS" | "EU" | "EMEA" | "APAC" | "GLOBAL";

export type LocationScope =
  | { kind: "any" }
  | { kind: "places"; countries: string[]; regions: Region[] }
  | { kind: "unknown" };

const LATAM_CODES = [
  "AR",
  "BO",
  "BR",
  "CL",
  "CO",
  "CR",
  "CU",
  "DO",
  "EC",
  "SV",
  "GT",
  "HN",
  "MX",
  "NI",
  "PA",
  "PY",
  "PE",
  "PR",
  "UY",
  "VE",
];
const AMERICAS_EXTRA = ["US", "CA", "BZ", "JM", "TT", "BS", "HT", "GY", "SR"];
const EUROPE_CODES = [
  "GB",
  "IE",
  "DE",
  "FR",
  "ES",
  "IT",
  "PT",
  "NL",
  "BE",
  "CH",
  "AT",
  "PL",
  "RO",
  "BA",
  "NO",
  "SE",
  "DK",
  "FI",
  "CZ",
  "HU",
  "GR",
  "BG",
  "RS",
  "HR",
  "UA",
  "SK",
  "SI",
  "LT",
  "LV",
  "EE",
];
const MEA_CODES = ["IL", "TR", "ZA", "NG", "KE", "EG", "AE"];
const APAC_CODES = ["IN", "AU", "NZ", "JP", "SG", "CN", "PH", "PK", "ID", "VN", "TH", "MY", "KR"];

const REGION_MEMBERS: Record<Exclude<Region, "GLOBAL">, ReadonlySet<string>> = {
  LATAM: new Set(LATAM_CODES),
  AMERICAS: new Set([...LATAM_CODES, ...AMERICAS_EXTRA]),
  EU: new Set(EUROPE_CODES),
  EMEA: new Set([...EUROPE_CODES, ...MEA_CODES]),
  APAC: new Set(APAC_CODES),
};

/** Nombres (sin acentos, en minúsculas) de los países de fuera de la región, por ISO-2. */
const OTHER_COUNTRY_NAMES: Readonly<Record<string, readonly string[]>> = {
  US: [
    "us",
    "usa",
    "united states",
    "united states of america",
    "estados unidos",
    "eeuu",
    "new mexico",
  ],
  CA: ["canada"],
  GB: ["uk", "united kingdom", "great britain", "england", "scotland", "wales", "reino unido"],
  IE: ["ireland", "irlanda"],
  DE: ["germany", "alemania"],
  FR: ["france", "francia"],
  ES: ["spain", "espana"],
  IT: ["italy", "italia"],
  PT: ["portugal"],
  NL: ["netherlands", "holland", "paises bajos"],
  BE: ["belgium", "belgica"],
  CH: ["switzerland", "suiza"],
  AT: ["austria"],
  PL: ["poland", "polonia"],
  RO: ["romania"],
  BA: ["bosnia", "bosnia and herzegovina"],
  NO: ["norway", "noruega"],
  SE: ["sweden", "suecia"],
  DK: ["denmark", "dinamarca"],
  FI: ["finland", "finlandia"],
  CZ: ["czechia", "czech republic"],
  HU: ["hungary", "hungria"],
  GR: ["greece", "grecia"],
  BG: ["bulgaria"],
  RS: ["serbia"],
  HR: ["croatia", "croacia"],
  UA: ["ukraine", "ucrania"],
  SK: ["slovakia"],
  SI: ["slovenia"],
  LT: ["lithuania"],
  LV: ["latvia"],
  EE: ["estonia"],
  IL: ["israel"],
  TR: ["turkey", "turquia"],
  ZA: ["south africa", "sudafrica"],
  NG: ["nigeria"],
  KE: ["kenya"],
  EG: ["egypt", "egipto"],
  AE: ["uae", "united arab emirates"],
  IN: ["india"],
  AU: ["australia"],
  NZ: ["new zealand", "nueva zelanda"],
  JP: ["japan", "japon"],
  SG: ["singapore", "singapur"],
  CN: ["china"],
  PH: ["philippines", "filipinas"],
  PK: ["pakistan"],
  ID: ["indonesia"],
  VN: ["vietnam"],
  TH: ["thailand", "tailandia"],
  MY: ["malaysia", "malasia"],
  KR: ["south korea", "corea del sur"],
};

type Phrase = { text: string; countries: readonly string[]; region: Region | null };

const regionPhrase = (region: Region, texts: readonly string[]): Phrase[] =>
  texts.map((text) => ({ text, countries: [], region }));
const groupPhrase = (countries: readonly string[], texts: readonly string[]): Phrase[] =>
  texts.map((text) => ({ text, countries, region: null }));

const PHRASES: readonly Phrase[] = [
  ...LATAM_CODES.flatMap((code) =>
    countryNames(code).map((text) => ({ text, countries: [code], region: null })),
  ),
  ...Object.entries(OTHER_COUNTRY_NAMES).flatMap(([code, names]) =>
    names.map((text) => ({ text, countries: [code], region: null })),
  ),
  ...regionPhrase("LATAM", [
    "latam",
    "latin america",
    "latinoamerica",
    "america latina",
    "south america",
    "sudamerica",
    "america del sur",
    "hispanoamerica",
    "iberoamerica",
    "cono sur",
  ]),
  ...regionPhrase("AMERICAS", ["americas", "las americas"]),
  ...regionPhrase("GLOBAL", ["global", "worldwide", "world wide", "anywhere in the world"]),
  ...regionPhrase("EU", ["eu", "europe", "europa", "european union", "eea"]),
  ...regionPhrase("EMEA", ["emea", "africa"]),
  ...regionPhrase("APAC", ["apac", "asia pacific", "asia"]),
  ...groupPhrase(["US", "CA", "MX"], ["north america", "norteamerica", "america del norte"]),
  ...groupPhrase(["GT", "HN", "SV", "NI", "CR", "PA", "BZ"], ["central america", "centroamerica"]),
  ...groupPhrase(["DE", "AT", "CH"], ["dach"]),
  ...groupPhrase(["SE", "NO", "DK", "FI"], ["nordics", "nordic"]),
].sort((a, b) => b.text.length - a.text.length);

/** Texto plegado y con las siglas de EE.UU. normalizadas, rodeado de espacios y sin signos. */
function normalizeText(value: string): string {
  const folded = foldText(value)
    .replace(/\bu\.s\.(?:a\.?)?/g, " us ")
    .replace(/\be\.e\.u\.u\.?/g, " us ")
    .replace(/\bee\.?\s*uu\b\.?/g, " us ");
  return ` ${folded.replace(/[^a-z0-9]+/g, " ").trim()} `;
}

type Found = { countries: Set<string>; regions: Set<Region> };

/**
 * Una mención de huso u horario ("US time zones", "US hours", "overlap with US", EST, GMT-3) en
 * cualquier parte del texto hace que el alcance sea unknown: no se interpreta el resto, falla
 * abierto y deciden `location_risk` y el LLM.
 */
const TZ_MENTION =
  / (?:time ?zones?|tz|hours|overlap(?:ping)?|est|edt|pst|pdt|cst|cdt|mst|mdt|gmt|utc) /;

/** Busca países y regiones en `value`; devuelve true si menciona huso u horario (y no sigue). */
function scan(value: string, into: Found): boolean {
  let padded = normalizeText(value);
  if (TZ_MENTION.test(padded)) return true;
  for (const p of PHRASES) {
    const needle = ` ${p.text} `;
    if (!padded.includes(needle)) continue;
    padded = padded.split(needle).join(" ");
    for (const c of p.countries) into.countries.add(c);
    if (p.region) into.regions.add(p.region);
  }
  return false;
}

const isoCode = (value: string) => (value === "UK" ? "GB" : value);

function toScope(found: Found): LocationScope {
  if (!found.countries.size && !found.regions.size) return { kind: "unknown" };
  return {
    kind: "places",
    countries: [...found.countries].sort(),
    regions: [...found.regions].sort(),
  };
}

/**
 * `countriesAllowed` manda sobre el texto cuando trae algo que se entiende. Las entradas que no son
 * ISO-2 (Get on Board puede traer "LATINOAMÉRICA") se leen como texto y nunca descartan por no ser
 * un código.
 */
export function locationScope(
  locationRaw: string | null | undefined,
  countriesAllowed: readonly string[] | null | undefined,
): LocationScope {
  const entries = (countriesAllowed ?? []).map((e) => e.trim()).filter(Boolean);
  if (entries.includes("*")) return { kind: "any" };
  const fromList: Found = { countries: new Set(), regions: new Set() };
  for (const e of entries) {
    if (/^[A-Z]{2}$/.test(e)) fromList.countries.add(isoCode(e));
    else if (scan(e, fromList)) return { kind: "unknown" };
  }
  const explicit = toScope(fromList);
  if (explicit.kind !== "unknown") return explicit;

  const fromText: Found = { countries: new Set(), regions: new Set() };
  if (scan(locationRaw ?? "", fromText)) return { kind: "unknown" };
  return toScope(fromText);
}

/** ¿La oferta admite a alguien de `iso2`? Sin país de la persona o con alcance desconocido, sí. */
export function allowsCountry(scope: LocationScope, iso2: string | null | undefined): boolean {
  if (scope.kind !== "places" || !iso2) return true;
  const code = isoCode(iso2.trim().toUpperCase());
  if (scope.countries.includes(code)) return true;
  return scope.regions.some((r) => r === "GLOBAL" || REGION_MEMBERS[r].has(code));
}
