/**
 * Tope de tamaño para lo que se guarda en el Data Cache de Next (C-7, arreglo #11). Next no guarda
 * entradas de más de 2 MB: avisa en el log y la página recalcula en cada visita, sin romperse pero
 * sin caché. Puro: el llamador decide cómo achicar el valor.
 */

/** Margen bajo los 2 MB de Next: el JSON del caché lleva además su envoltorio. */
export const DATA_CACHE_MAX_BYTES = 1_800_000;

/** Bytes UTF-8 del JSON del valor (lo que el Data Cache termina guardando). */
export function jsonByteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

/** El valor tal cual si entra en el tope; si no, el que devuelve `shrink`. */
export function fitCacheValue<T>(
  value: T,
  shrink: (value: T) => T,
  maxBytes: number = DATA_CACHE_MAX_BYTES,
): T {
  return jsonByteLength(value) <= maxBytes ? value : shrink(value);
}
