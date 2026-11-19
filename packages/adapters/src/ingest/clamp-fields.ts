import type { RawJob } from "@job-search-os/pipeline";

/** Mismos topes que la alta manual. */
export const RAW_FIELD_MAX_CHARS = 300;
export const RAW_SALARY_NOTE_MAX_CHARS = 200;

const clip = <T extends string | null>(value: T, max: number): T =>
  typeof value === "string" && value.length > max ? (value.slice(0, max) as T) : value;

/**
 * Recorta los textos cortos de una oferta venga de la fuente que venga: título, empresa y
 * ubicación a 300 caracteres, nota de sueldo a 200. No toca la JD ni el crudo guardado.
 */
export function clampRawJobFields(raw: RawJob): RawJob {
  return {
    ...raw,
    title: clip(raw.title, RAW_FIELD_MAX_CHARS),
    companyRaw: clip(raw.companyRaw, RAW_FIELD_MAX_CHARS),
    locationRaw: clip(raw.locationRaw, RAW_FIELD_MAX_CHARS),
    salaryNote: clip(raw.salaryNote, RAW_SALARY_NOTE_MAX_CHARS),
  };
}
