/**
 * Vigencia de una oferta del pool (R30-07). El pool no marca avisos cerrados: una fuente que deja de
 * mostrar un aviso simplemente no lo vuelve a ver, y `public_jobs.last_seen_at` deja de avanzar. Por
 * eso «ya no figura» se deduce de eso, y solo si el resto del pool sigue actualizándose (si todo el
 * pool está quieto, el problema es del cron, no del aviso). Falla cerrado: ante la duda no se afirma
 * nada. De lo que no viene del pool tampoco se afirma nada.
 */

/** Mismo umbral que la selección del pool para considerar «vivo» un aviso (SEEN_WINDOW_DAYS). */
export const GONE_AFTER_DAYS = 14;
/** El pool cuenta como «al día» si algo se vio en los últimos días. */
export const POOL_FRESH_DAYS = 3;

const DAY_MS = 86_400_000;

export type SourceFreshnessInput = {
  /** `jobs.public_job_id` no es null. */
  fromPool: boolean;
  /** `public_jobs.last_seen_at` de su aviso; null si no se pudo leer. */
  lastSeenAt: Date | null;
  /** `max(public_jobs.last_seen_at)` de todo el pool; null si no se pudo leer. */
  poolNewestSeenAt: Date | null;
  now: Date;
};

const valid = (d: Date | null): d is Date => d instanceof Date && Number.isFinite(d.getTime());

export function isGoneFromSource(input: SourceFreshnessInput): boolean {
  if (!input.fromPool) return false;
  const { lastSeenAt, poolNewestSeenAt, now } = input;
  if (!valid(lastSeenAt) || !valid(poolNewestSeenAt) || !valid(now)) return false;
  if (now.getTime() - poolNewestSeenAt.getTime() > POOL_FRESH_DAYS * DAY_MS) return false;
  return now.getTime() - lastSeenAt.getTime() > GONE_AFTER_DAYS * DAY_MS;
}
