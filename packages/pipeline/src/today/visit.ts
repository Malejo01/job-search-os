/** Nombre de la cookie que guarda la última visita a «Hoy». */
export const VISIT_COOKIE = "jso_ultima_visita";
/**
 * Pasado este tiempo desde la última visita marcada, la siguiente carga cuenta como una visita
 * nueva. La ventana se mide desde esa marca y no se desliza con la actividad: seguir navegando no la
 * extiende.
 */
export const VISIT_WINDOW_MS = 30 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

export type VisitWindow = {
  /** Desde cuándo mostrar novedades; null si no hay visita anterior conocida. */
  since: Date | null;
  /** Valor nuevo de la cookie, o null si no hay que reescribirla. */
  stamp: string | null;
};

function parseEpoch(part: string): number | null {
  if (!/^\d+$/.test(part)) return null;
  const n = Number(part);
  return Number.isSafeInteger(n) ? n : null;
}

/**
 * Ventana de «desde tu última visita». Valor de cookie: `${userId}.${anterior}.${actual}` (epoch en
 * segundos). Pura: recibe `now`. Un uuid no tiene puntos, así que se exigen exactamente 3 partes.
 */
export function visitWindow(cookie: string | undefined, userId: string, now: Date): VisitWindow {
  const nowSec = Math.floor(now.getTime() / 1000);
  const fresh: VisitWindow = { since: null, stamp: `${userId}.0.${nowSec}` };
  if (!cookie) return fresh;

  const parts = cookie.split(".");
  if (parts.length !== 3 || parts[0] !== userId) return fresh;
  const previous = parseEpoch(parts[1] ?? "");
  const current = parseEpoch(parts[2] ?? "");
  if (previous === null || current === null) return fresh;
  if (current * 1000 - now.getTime() > DAY_MS) return fresh;
  if (previous > current) return fresh;

  if (now.getTime() - current * 1000 > VISIT_WINDOW_MS) {
    return { since: new Date(current * 1000), stamp: `${userId}.${current}.${nowSec}` };
  }
  return { since: previous === 0 ? null : new Date(previous * 1000), stamp: null };
}
