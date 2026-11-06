/**
 * Inactividad y agrupado de /applications (R4-07). Funciones puras: la fecha de hoy entra por
 * parámetro (ADR-001) y nada de esto cambia la base; se calcula al mostrar.
 */
import { FOLLOW_UP_SNOOZE_DAYS } from "./followup";

/** Días sin novedades a partir de los cuales una postulación (o una oferta evaluada) se da por inactiva. */
export const INACTIVE_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

export type InactivityInput = {
  status: string;
  outcome: string | null;
  appliedAt: Date | null;
  outcomeAt: Date | null;
  /** Postergación elegida por la persona (`applications.follow_up_at`). */
  followUpAt: Date | null;
  /** `jobs.updated_at`: cualquier cambio de estado o corrección de la oferta. */
  touchedAt: Date | null;
};

/**
 * Fecha de la última novedad: el máximo entre la postulación, el resultado, el día en que se
 * postergó (`followUpAt` menos `FOLLOW_UP_SNOOZE_DAYS`) y `jobs.updated_at`. Null si no hay fechas.
 * Nota: una re-evaluación que toque `updated_at` también cuenta como novedad (se acepta).
 */
export function lastActivity(input: InactivityInput): Date | null {
  const times: number[] = [];
  if (input.appliedAt) times.push(input.appliedAt.getTime());
  if (input.outcomeAt) times.push(input.outcomeAt.getTime());
  if (input.followUpAt) times.push(input.followUpAt.getTime() - FOLLOW_UP_SNOOZE_DAYS * DAY_MS);
  if (input.touchedAt) times.push(input.touchedAt.getTime());
  return times.length ? new Date(Math.max(...times)) : null;
}

/** Aplicada sin respuesta y con INACTIVE_DAYS o más sin novedades. */
export function isInactiveApplication(input: InactivityInput, today: Date): boolean {
  if (input.status !== "aplicada") return false;
  if ((input.outcome ?? "sin_respuesta") !== "sin_respuesta") return false;
  const last = lastActivity(input);
  if (!last) return false;
  return today.getTime() - last.getTime() >= INACTIVE_DAYS * DAY_MS;
}

/** Oferta evaluada que nunca se aplicó y con INACTIVE_DAYS o más sin tocar. */
export function isInactiveEvaluated(
  input: { status: string; touchedAt: Date | null },
  today: Date,
): boolean {
  if (input.status !== "evaluada" || !input.touchedAt) return false;
  return today.getTime() - input.touchedAt.getTime() >= INACTIVE_DAYS * DAY_MS;
}

export type ApplicationGroup = "seguimiento" | "activas" | "esperando" | "inactivas" | "cerradas";

/** Un solo grupo por postulación, con la precedencia: inactividad, seguimiento, activas, esperando, cerradas. */
export function groupApplication(
  input: InactivityInput & { followUpDue: boolean },
  today: Date,
): ApplicationGroup {
  if (isInactiveApplication(input, today)) return "inactivas";
  const open = input.status === "aplicada" || input.status === "entrevista";
  if (open && input.followUpDue) return "seguimiento";
  if (input.status === "entrevista" || input.status === "oferta") return "activas";
  if (input.status === "aplicada") {
    const outcome = input.outcome ?? "sin_respuesta";
    if (outcome === "sin_respuesta") return "esperando";
    if (outcome === "entrevista" || outcome === "oferta") return "activas";
  }
  return "cerradas";
}
