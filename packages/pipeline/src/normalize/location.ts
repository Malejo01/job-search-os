import { foldText, squash, stripBrackets } from "./text";

/**
 * Países de la región (mismos códigos que COUNTRY_OPTIONS del onboarding) con sus nombres en
 * español e inglés, ya sin acentos y en minúsculas: se comparan contra texto pasado por foldText.
 */
const COUNTRY_NAMES: Readonly<Record<string, readonly string[]>> = {
  AR: ["argentina"],
  BO: ["bolivia"],
  BR: ["brasil", "brazil"],
  CL: ["chile"],
  CO: ["colombia"],
  CR: ["costa rica"],
  CU: ["cuba"],
  DO: ["republica dominicana", "dominican republic"],
  EC: ["ecuador"],
  SV: ["el salvador"],
  GT: ["guatemala"],
  HN: ["honduras"],
  MX: ["mexico"],
  NI: ["nicaragua"],
  PA: ["panama"],
  PY: ["paraguay"],
  PE: ["peru"],
  PR: ["puerto rico"],
  UY: ["uruguay"],
  VE: ["venezuela"],
};

const nameRegex = (name: string) => new RegExp(`(?<![a-z0-9])${name}(?![a-z0-9])`);
const COUNTRY_REGEX: readonly (readonly [string, RegExp])[] = Object.entries(COUNTRY_NAMES).flatMap(
  ([code, names]) => names.map((n) => [code, nameRegex(n)] as const),
);

/** Nombres (es/en, sin acentos) de un país de la región por su código ISO-2; `[]` si no está en la tabla. */
export function countryNames(code: string): readonly string[] {
  return COUNTRY_NAMES[code.toUpperCase()] ?? [];
}

/** Códigos de los países de la región que nombra un texto ya pasado por foldText. */
export function countriesMentioned(foldedText: string): string[] {
  return [...new Set(COUNTRY_REGEX.filter(([, re]) => re.test(foldedText)).map(([c]) => c))];
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
