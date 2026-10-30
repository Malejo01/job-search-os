import { OTHER_COUNTRY_NAMES, REGION_COUNTRIES } from "../countries";
import { foldText, squash, stripBrackets } from "./text";

/**
 * Nombres de los países de la región por código, ya sin acentos y en minúsculas: se comparan
 * contra texto pasado por foldText. Salen de REGION_COUNTRIES, la misma tabla del onboarding.
 */
const COUNTRY_NAMES: ReadonlyMap<string, readonly string[]> = new Map(
  REGION_COUNTRIES.map(({ code, label, aliases }) => [code, [foldText(label), ...aliases]]),
);

/**
 * Lo que no puede venir justo antes de un nombre para que cuente como el país: "New Mexico" y
 * "Nuevo México" son un estado de EE.UU., no México (JS-111). Fuera de la región (N4-2): "Baja
 * California" es México, "New England" es EE.UU., "New South Wales" es Australia y "Northern
 * Ireland" es Reino Unido.
 */
const NOT_AFTER: Readonly<Record<string, string>> = {
  mexico: "(?:new|nuevo)[\\s-]+",
  california: "baja[\\s-]+",
  england: "new[\\s-]+",
  wales: "new[\\s-]+south[\\s-]+",
  ireland: "northern[\\s-]+",
};

/**
 * Lo que no puede venir justo después: "San Francisco de Macorís" (República Dominicana) y "San
 * Francisco de Quito" (Ecuador) no son la ciudad de EE.UU. (N4-2).
 */
const NOT_BEFORE: Readonly<Record<string, string>> = { "san francisco": "[\\s-]+de(?![a-z0-9])" };

const nameRegex = (name: string, wholeWord: boolean) => {
  const notAfter = NOT_AFTER[name] ? `(?<!${NOT_AFTER[name]})` : "";
  const notBefore = NOT_BEFORE[name] ? `(?!${NOT_BEFORE[name]})` : "";
  return new RegExp(
    `(?<![a-z0-9])${notAfter}${name}${wholeWord ? "(?![a-z0-9])" : ""}${notBefore}`,
  );
};
const regexByCode = (wholeWord: boolean): ReadonlyMap<string, readonly RegExp[]> =>
  new Map(
    [...COUNTRY_NAMES].map(([code, names]) => [code, names.map((n) => nameRegex(n, wholeWord))]),
  );
const COUNTRY_REGEX = regexByCode(true);
const COUNTRY_PREFIX_REGEX = regexByCode(false);

/**
 * Las frases que NOT_AFTER saca de un país cuentan como el lugar que sí nombran, para que
 * "Belfast, Northern Ireland" no quede sin país. Solo acá, no en la tabla ni en el pool: "Baja
 * California" no se agrega porque México es de la región y su tabla no cambia.
 */
const OTHER_COMPOUND_NAMES: Readonly<Record<string, readonly string[]>> = {
  US: ["new england"],
  AU: ["new south wales"],
  GB: ["northern ireland"],
};

/**
 * Países de fuera de la región (N4-2), solo por palabra entera: por prefijo, "us" matchearía
 * "usual" e "india" matchearía "indiana". "New Mexico" y "Nuevo México" son nombres de US.
 */
const OTHER_COUNTRY_REGEX: ReadonlyMap<string, readonly RegExp[]> = new Map(
  Object.entries(OTHER_COUNTRY_NAMES)
    .filter(([code]) => !COUNTRY_NAMES.has(code))
    .map(([code, names]) => [
      code,
      [...names, ...(OTHER_COMPOUND_NAMES[code] ?? [])].map((n) => nameRegex(n, true)),
    ]),
);

/**
 * Huso u horario ("US hours", "US time zone", "overlap with US", EST, GMT-3): el mismo criterio
 * que `TZ_MENTION` de `pool/location-scope.ts` (que trabaja sobre texto sin signos), acá sobre texto
 * pasado por foldText. Si cambia uno, cambiar el otro.
 */
const TZ_MENTION =
  /(?<![a-z0-9])(?:time[\s-]?zones?|tz|hours|overlap(?:ping)?|est|edt|pst|pdt|cst|cdt|mst|mdt|gmt|utc)(?![a-z0-9])/;

/** ¿Un texto ya pasado por foldText menciona un huso u horario? */
export function mentionsTimeZone(foldedText: string): boolean {
  return TZ_MENTION.test(foldedText);
}

export type MentionOptions = {
  /** Palabra entera (default) o prefijo, para que cuenten los gentilicios. Solo en la región. */
  wholeWord?: boolean;
  /**
   * También los países de fuera de la región (`OTHER_COUNTRY_NAMES`), siempre por palabra entera
   * aunque se pida prefijo. Default `false`: solo la región, como antes de N4-2.
   */
  outsideRegion?: boolean;
};

/** Nombres (es/en, sin acentos) de un país de la región por su código ISO-2; `[]` si no está en la tabla. */
export function countryNames(code: string): readonly string[] {
  return COUNTRY_NAMES.get(code.toUpperCase()) ?? [];
}

/**
 * ¿Un texto ya pasado por foldText nombra este país? Palabra entera, no subcadena; con
 * `wholeWord: false` alcanza con que una palabra empiece con el nombre, así los gentilicios cuentan
 * ("peruanos", "Brazilian"). Sin `outsideRegion`, un país fuera de la región nunca se reconoce:
 * `false` (quien llama lo trata como no mencionado). Con `outsideRegion`, se reconoce por los
 * nombres de `OTHER_COUNTRY_NAMES`, siempre por palabra entera.
 */
export function mentionsCountry(
  foldedText: string,
  code: string,
  { wholeWord = true, outsideRegion = false }: MentionOptions = {},
): boolean {
  const key = code.toUpperCase();
  const byCode = wholeWord ? COUNTRY_REGEX : COUNTRY_PREFIX_REGEX;
  const regexes =
    byCode.get(key) ?? (outsideRegion ? OTHER_COUNTRY_REGEX.get(key) : undefined) ?? [];
  return regexes.some((re) => re.test(foldedText));
}

/**
 * Códigos de los países que nombra un texto ya pasado por foldText, por palabra entera: los de la
 * región y, con `outsideRegion`, después los de `OTHER_COUNTRY_NAMES`.
 */
export function countriesMentioned(
  foldedText: string,
  { outsideRegion = false }: Pick<MentionOptions, "outsideRegion"> = {},
): string[] {
  const codes = [...COUNTRY_REGEX.keys(), ...(outsideRegion ? OTHER_COUNTRY_REGEX.keys() : [])];
  return codes.filter((code) => mentionsCountry(foldedText, code, { outsideRegion }));
}

/**
 * Ubicación normalizada para comparar dos avisos (dedup, JS-085): minúsculas, sin acentos, sin
 * paréntesis ni "remoto"/"remote". Si no queda nada, `null` (ubicación desconocida).
 */
export function normalizeLocation(input: string | null | undefined): string | null {
  if (!input) return null;
  const out = squash(
    stripBrackets(foldText(input))
      .replace(/\b(?:remoto|remota|remote)\b/g, " ")
      .replace(/\s+/g, " ")
      .replace(/^[\s,;/|-]+|[\s,;/|-]+$/g, ""),
  );
  return out || null;
}
