/**
 * Orden del listado (R30-04, R30-07). Puro: recibe qué le pasa a cada oferta y devuelve el grupo.
 * Baja, sin ocultar ni borrar, las ofertas con una condición excluyente que no coincide y las que
 * ya no figuran en su fuente. Dentro de cada grupo se respeta el orden que ya traía la lista
 * (afinidad, bloqueadores, fecha), así que el sort es estable.
 */
export type ListingOrderInput = {
  /** Se está evaluando o reevaluando: se ve arriba con su «Leyendo…», todavía no baja. */
  evaluating: boolean;
  /** Tiene una fila `must` que bloquea y no coincide (`summarizeRequirements().blocking`). */
  excludingNoMatch: boolean;
  /** Viene del pool y la fuente ya no la muestra (`isGoneFromSource`). */
  goneFromSource: boolean;
};

/** 0 = arriba · 1 = condición excluyente que no coincide · 2 = ya no figura en su fuente. */
export type ListingTier = 0 | 1 | 2;

export function listingTier(row: ListingOrderInput): ListingTier {
  if (row.evaluating) return 0;
  if (row.goneFromSource) return 2;
  if (row.excludingNoMatch) return 1;
  return 0;
}

/** Orden estable por grupo; no muta la entrada. */
export function sortByListingTier<T>(rows: readonly T[], pick: (row: T) => ListingOrderInput): T[] {
  return rows
    .map((row, index) => ({ row, index, tier: listingTier(pick(row)) }))
    .sort((a, b) => a.tier - b.tier || a.index - b.index)
    .map((x) => x.row);
}
