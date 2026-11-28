import { foldText } from "../normalize/text";
import { acceptsCountry } from "./countries-accepted";
import { isEntryLevel } from "./entry-level";

/**
 * Chips de filtro del listado (R30-05). Puro: cada chip es un predicado sobre datos del aviso. El
 * número de cada chip es cuántas ofertas de la pestaña quedarían si se activa (junto con los que ya
 * están activos), así el contador y los chips nunca se contradicen.
 */
export const CHIP_KEYS = ["remoto", "cerca", "pais", "espanol", "inicio"] as const;
export type ChipKey = (typeof CHIP_KEYS)[number];

export type ChipRow = {
  title: string;
  modality: string | null;
  locationRaw: string | null;
  /** `jobs.countries_allowed`: null = el aviso no lo dice. */
  countriesAllowed: readonly string[] | null;
  /** Idioma guardado del aviso del pool (`es`, `en`, `pt`); null = sin dato. */
  lang: string | null;
  /** Nivel del aviso del pool; null = sin dato. */
  seniority: string | null;
};

export type ChipContext = {
  /** Ciudad del perfil; sin ella el chip «En {ciudad}» no entra. */
  city: string | null;
  /** País del perfil (ISO-2); sin él el chip «Aceptan {país}» no entra. */
  country: string | null;
};

export function parseChipKeys(values: readonly string[]): ChipKey[] {
  return CHIP_KEYS.filter((k) => values.includes(k));
}

const fold = (s: string) =>
  foldText(s)
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export function matchesChip(key: ChipKey, row: ChipRow, ctx: ChipContext): boolean {
  switch (key) {
    case "remoto":
      return row.modality === "remoto";
    case "cerca": {
      const city = ctx.city ? fold(ctx.city) : "";
      return (
        city !== "" &&
        row.locationRaw !== null &&
        ` ${fold(row.locationRaw)} `.includes(` ${city} `)
      );
    }
    case "pais":
      return acceptsCountry(row.countriesAllowed, ctx.country);
    case "espanol":
      return row.lang === "es";
    case "inicio":
      return isEntryLevel(row.seniority, row.title);
  }
}

export function applyChips<T extends ChipRow>(
  rows: readonly T[],
  ctx: ChipContext,
  active: readonly ChipKey[],
): T[] {
  return rows.filter((r) => active.every((k) => matchesChip(k, r, ctx)));
}

export function chipCounts(
  rows: readonly ChipRow[],
  ctx: ChipContext,
  active: readonly ChipKey[],
): Record<ChipKey, number> {
  const out = {} as Record<ChipKey, number>;
  for (const key of CHIP_KEYS) {
    const keys = active.includes(key) ? active : [...active, key];
    out[key] = applyChips(rows, ctx, keys).length;
  }
  return out;
}
