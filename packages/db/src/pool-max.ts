/** Conexiones por instancia hacia la base cuando `DB_POOL_MAX` no está o no es válido (el valor de siempre). */
export const DEFAULT_DB_POOL_MAX = 5;
const MIN = 1;
const MAX = 20;

/**
 * Lee `DB_POOL_MAX`: entero entre 1 y 20. Vacío o ausente → default sin avisar; cualquier otra cosa
 * (decimal, texto, fuera de rango) → default y `invalid: true` para que quien llama lo registre.
 */
export function parseDbPoolMax(raw: string | undefined): { max: number; invalid: boolean } {
  if (raw === undefined || raw.trim() === "") return { max: DEFAULT_DB_POOL_MAX, invalid: false };
  const t = raw.trim();
  const n = /^\d+$/.test(t) ? Number(t) : NaN;
  if (Number.isInteger(n) && n >= MIN && n <= MAX) return { max: n, invalid: false };
  return { max: DEFAULT_DB_POOL_MAX, invalid: true };
}
