import { REGION_COUNTRIES } from "../countries";
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
 * "Nuevo México" son un estado de EE.UU., no México (JS-111).
 */
const NOT_AFTER: Readonly<Record<string, string>> = { mexico: "(?:new|nuevo)[\\s-]+" };

const nameRegex = (name: string, wholeWord: boolean) => {
  const notAfter = NOT_AFTER[name] ? `(?<!${NOT_AFTER[name]})` : "";
  return new RegExp(`(?<![a-z0-9])${notAfter}${name}${wholeWord ? "(?![a-z0-9])" : ""}`);
};
const regexByCode = (wholeWord: boolean): ReadonlyMap<string, readonly RegExp[]> =>
  new Map(
    [...COUNTRY_NAMES].map(([code, names]) => [code, names.map((n) => nameRegex(n, wholeWord))]),
  );
const COUNTRY_REGEX = regexByCode(true);
const COUNTRY_PREFIX_REGEX = regexByCode(false);

/** Nombres (es/en, sin acentos) de un país de la región por su código ISO-2; `[]` si no está en la tabla. */
export function countryNames(code: string): readonly string[] {
  return COUNTRY_NAMES.get(code.toUpperCase()) ?? [];
}

/**
 * ¿Un texto ya pasado por foldText nombra este país de la región? Palabra entera, no subcadena; con
 * `wholeWord: false` alcanza con que una palabra empiece con el nombre, así los gentilicios cuentan
 * ("peruanos", "Brazilian"). Un país fuera de la tabla nunca se reconoce: `false` (quien llama lo
 * trata como no mencionado).
 */
export function mentionsCountry(
  foldedText: string,
  code: string,
  { wholeWord = true }: { wholeWord?: boolean } = {},
): boolean {
  const byCode = wholeWord ? COUNTRY_REGEX : COUNTRY_PREFIX_REGEX;
  return (byCode.get(code.toUpperCase()) ?? []).some((re) => re.test(foldedText));
}

/** Códigos de los países de la región que nombra un texto ya pasado por foldText. */
export function countriesMentioned(foldedText: string): string[] {
  return [...COUNTRY_REGEX.keys()].filter((code) => mentionsCountry(foldedText, code));
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
