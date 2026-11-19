import {
  BADGE_PROMPT_MAX_CHARS,
  BADGES_PROMPT_MAX_ITEMS,
  CONTRACT_PROMPT_MAX_CHARS,
  COUNTRIES_PROMPT_MAX_ITEMS,
  COUNTRY_PROMPT_MAX_CHARS,
  type RawJob,
} from "@job-search-os/pipeline";

/** Mismos topes que la alta manual. */
export const RAW_FIELD_MAX_CHARS = 300;
export const RAW_SALARY_NOTE_MAX_CHARS = 200;
/** Contrato: el mismo tope que tiene en el prompt. */
export const RAW_CONTRACT_MAX_CHARS = CONTRACT_PROMPT_MAX_CHARS;

/** Recorta un texto corto de una oferta (título, empresa, ubicación, contrato, nota de sueldo). */
export const clip = <T extends string | null>(value: T, max: number): T =>
  typeof value === "string" && value.length > max ? (value.slice(0, max) as T) : value;

/** Lista acotada en cantidad y en largo de cada elemento; `null` queda `null`. */
const clipList = <T extends string[] | null>(list: T, maxItems: number, maxChars: number): T =>
  Array.isArray(list)
    ? (list.slice(0, maxItems).map((x) => clip(x, maxChars)) as unknown as T)
    : list;

/**
 * Recorta los textos cortos de una oferta venga de la fuente que venga: título, empresa y
 * ubicación a 300 caracteres, nota de sueldo a 200, contrato a 100, países y etiquetas con tope de
 * cantidad y de largo. No toca la JD ni el crudo guardado.
 */
export function clampRawJobFields(raw: RawJob): RawJob {
  return {
    ...raw,
    title: clip(raw.title, RAW_FIELD_MAX_CHARS),
    companyRaw: clip(raw.companyRaw, RAW_FIELD_MAX_CHARS),
    locationRaw: clip(raw.locationRaw, RAW_FIELD_MAX_CHARS),
    salaryNote: clip(raw.salaryNote, RAW_SALARY_NOTE_MAX_CHARS),
    contractType: clip(raw.contractType, RAW_CONTRACT_MAX_CHARS),
    countriesAllowed: clipList(
      raw.countriesAllowed,
      COUNTRIES_PROMPT_MAX_ITEMS,
      COUNTRY_PROMPT_MAX_CHARS,
    ),
    badges: clipList(raw.badges, BADGES_PROMPT_MAX_ITEMS, BADGE_PROMPT_MAX_CHARS),
  };
}
