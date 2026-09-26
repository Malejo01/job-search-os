import type { JobStatus } from "./status";

/**
 * Flujo de revisión de la lista (JS-061): recorrer las ofertas de mayor a menor score, salteando
 * las que ya tienen una acción tomada, hasta terminar las verdes del período. Funciones puras: la
 * hora actual y la zona entran como parámetro, así se testean sin reloj ni base.
 */

/** Zona del perfil cuando no hay otra cargada (profiles.timezone tiene el mismo default). */
export const DEFAULT_TIMEZONE = "America/Argentina/Salta";

/**
 * Estados con una acción tomada. "Revisada" es esto y no "la abrí": mirarla y dejarla en
 * `evaluada` no la saca de la cola, que es justamente lo que la mantiene pendiente.
 */
export const ACTED_STATUSES = [
  "aplicada",
  "entrevista",
  "oferta",
  "rechazada",
  "rechazo_automatico",
  "descartada",
  "cerrada",
] as const satisfies readonly JobStatus[];

const ACTED = new Set<string>(ACTED_STATUSES);

/** Verde = la evaluación recomienda postular. `aplicar_personalizado` cuenta igual que `aplicar`. */
export function isVerde(accion: string | null | undefined): boolean {
  return accion === "aplicar" || accion === "aplicar_personalizado";
}

export type ReviewProgress = { total: number; revisadas: number };

/** "X de Y ofertas verdes revisadas": solo cuentan las verdes, en cualquier estado. */
export function reviewProgress(
  rows: readonly { status: string; accion: string | null }[],
): ReviewProgress {
  let total = 0;
  let revisadas = 0;
  for (const r of rows) {
    if (!isVerde(r.accion)) continue;
    total++;
    if (ACTED.has(r.status)) revisadas++;
  }
  return { total, revisadas };
}

export type Period = "hoy" | "semana";

/** Atajo de fecha de la URL; cualquier otra cosa es "todas" (sin límite). */
export function parsePeriod(value: string | null | undefined): Period | null {
  return value === "hoy" || value === "semana" ? value : null;
}

type ZonedDate = { year: number; month: number; day: number; weekday: number };

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Fecha calendario (y día de la semana, 0 = domingo) de un instante en una zona. */
function zonedDate(instant: Date, timeZone: string): ZonedDate {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    weekday: WEEKDAYS[get("weekday")] ?? 0,
  };
}

/** Diferencia entre la hora de pared de la zona y UTC en ese instante, en ms (Salta: −3 h). */
function offsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const wall = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return wall - instant.getTime();
}

function startOfDay(year: number, month: number, day: number, timeZone: string): Date {
  const guess = Date.UTC(year, month - 1, day);
  // Dos pasadas: si justo ese día cambia el horario, el offset de la medianoche local puede
  // diferir del de la medianoche UTC. Con zonas de offset fijo (Salta) la segunda no cambia nada.
  const first = guess - offsetMs(new Date(guess), timeZone);
  return new Date(guess - offsetMs(new Date(first), timeZone));
}

/**
 * Medianoche de un día (YYYY-MM-DD) en la zona dada. El filtro `Desde` armaba
 * `${fecha}T00:00:00Z`, que en Salta son las 21 del día anterior.
 */
export function startOfDayInZone(isoDate: string, timeZone: string): Date {
  const [year, month, day] = isoDate.split("-").map(Number) as [number, number, number];
  return startOfDay(year, month, day, timeZone);
}

/** Inicio del período en la zona: "hoy" = medianoche de hoy, "semana" = el lunes de esta semana. */
export function periodStart(period: Period | null, now: Date, timeZone: string): Date | null {
  if (!period) return null;
  const today = zonedDate(now, timeZone);
  if (period === "hoy") return startOfDay(today.year, today.month, today.day, timeZone);
  // La semana arranca el lunes: domingo (0) está a 6 días del lunes, lunes (1) a 0
  const back = (today.weekday + 6) % 7;
  const monday = new Date(Date.UTC(today.year, today.month - 1, today.day - back));
  return startOfDay(
    monday.getUTCFullYear(),
    monday.getUTCMonth() + 1,
    monday.getUTCDate(),
    timeZone,
  );
}

/** Límite inferior de `first_seen`: el atajo y el `Desde` manual; si hay los dos, el más reciente. */
export function resolveSince(
  filters: { periodo: Period | null; desde: string | null },
  now: Date,
  timeZone: string,
): Date | null {
  const candidates = [
    periodStart(filters.periodo, now, timeZone),
    filters.desde ? startOfDayInZone(filters.desde, timeZone) : null,
  ].filter((d): d is Date => d !== null);
  if (!candidates.length) return null;
  return new Date(Math.max(...candidates.map((d) => d.getTime())));
}

/**
 * Anterior y siguiente de una oferta dentro de la lista ya ordenada. El orden lo decide la
 * consulta de la lista, no esto: así "siguiente" y la lista no pueden divergir.
 */
export function neighbors(
  orderedIds: readonly string[],
  currentId: string,
): { prev: string | null; next: string | null } {
  const i = orderedIds.indexOf(currentId);
  if (i === -1) return { prev: null, next: null };
  return { prev: orderedIds[i - 1] ?? null, next: orderedIds[i + 1] ?? null };
}
