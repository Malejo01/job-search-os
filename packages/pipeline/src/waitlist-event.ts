import { normalizeAccesoOrigin } from "./acceso-funnel";

/**
 * Excepción de los topes de la lista de espera para una presentación en vivo con QR (C8-3, 11/11).
 *
 * El salón entra por un solo wifi (una IP pública): con los topes normales (40 por IP por hora y 60
 * cada 10 minutos en total) la persona 41 del salón queda afuera. Durante una ventana horaria corta,
 * fijada por variable (`WAITLIST_EVENT_WINDOW`, apagada por defecto) y solo para `?origen=voces-jovenes`,
 * el servidor usa `waitlist_join_event()`, con topes más altos pero igual acotados (rls/0006: 120 por IP por hora, 200 cada 10 minutos). El tope
 * diario no cambia. Puro: la web decide con la hora del servidor.
 */
export const WAITLIST_EVENT_ORIGIN = "voces-jovenes";
/** Una ventana más larga que esto se ignora: la excepción no puede quedar prendida días. */
export const WAITLIST_EVENT_MAX_HOURS = 12;

export type WaitlistEventWindow = { start: Date; end: Date };

// Fecha y hora ISO con zona explícita (Z o ±hh:mm): sin zona, la hora dependería del servidor
const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/** `inicio/fin` (ISO 8601 con zona). Cualquier cosa fuera de forma → null (falla cerrado: sin excepción). */
export function parseWaitlistEventWindow(
  raw: string | undefined | null,
): WaitlistEventWindow | null {
  if (!raw) return null;
  const parts = raw.trim().split("/");
  if (parts.length !== 2) return null;
  const [a, b] = parts.map((p) => p.trim());
  if (!a || !b || !ISO_WITH_ZONE.test(a) || !ISO_WITH_ZONE.test(b)) return null;
  const start = new Date(a);
  const end = new Date(b);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  const hours = (end.getTime() - start.getTime()) / 3_600_000;
  if (hours <= 0 || hours > WAITLIST_EVENT_MAX_HOURS) return null;
  return { start, end };
}

/** ¿Este pedido usa los topes del evento? Solo con el origen del QR y dentro de [inicio, fin). */
export function waitlistEventApplies(
  window: WaitlistEventWindow | null,
  now: Date,
  origen: string | null | undefined,
): boolean {
  if (!window) return false;
  if (normalizeAccesoOrigin(origen) !== WAITLIST_EVENT_ORIGIN) return false;
  const t = now.getTime();
  return t >= window.start.getTime() && t < window.end.getTime();
}
