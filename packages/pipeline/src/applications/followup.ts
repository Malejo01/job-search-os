/**
 * Seguimiento de postulaciones (ronda 113). Función pura: recibe el estado y las fechas y devuelve
 * si toca hacer seguimiento. La fecha de hoy entra por parámetro (ADR-001).
 */

/** Días sin novedades a partir de los cuales una postulación pide seguimiento, por estado. */
export const FOLLOW_UP_DAYS = { aplicada: 7, entrevista: 5 } as const;

/** Cuántos días posterga «Ya hice seguimiento». */
export const FOLLOW_UP_SNOOZE_DAYS = 7;

export type FollowUpInput = {
  status: string;
  appliedAt: Date | null;
  outcomeAt: Date | null;
  /** Postergación elegida por la persona (`applications.follow_up_at`). */
  followUpAt: Date | null;
};

export type FollowUpResult = { due: boolean; dueSince: Date | null };

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Vence si `max(referencia + N días, followUpAt) <= hoy`. La referencia es `appliedAt` en `aplicada`
 * y `outcomeAt` (o `appliedAt` si falta) en `entrevista`. Cualquier otro estado, o sin fecha de
 * referencia, no vence. `dueSince` es el momento en que empezó a vencer.
 */
export function followUpDue(input: FollowUpInput, today: Date): FollowUpResult {
  const days =
    input.status === "aplicada"
      ? FOLLOW_UP_DAYS.aplicada
      : input.status === "entrevista"
        ? FOLLOW_UP_DAYS.entrevista
        : null;
  if (days === null) return { due: false, dueSince: null };
  const reference =
    input.status === "entrevista" ? (input.outcomeAt ?? input.appliedAt) : input.appliedAt;
  if (!reference) return { due: false, dueSince: null };
  const base = reference.getTime() + days * DAY_MS;
  // Una postergación hecha antes de la referencia (la persona pospuso cuando estaba «aplicada» y
  // después llegó la entrevista) no cuenta: si no, ocultaría el aviso de la entrevista. Se la
  // fechó `FOLLOW_UP_SNOOZE_DAYS` antes de `followUpAt`.
  const snoozedOn = input.followUpAt
    ? input.followUpAt.getTime() - FOLLOW_UP_SNOOZE_DAYS * DAY_MS
    : null;
  const snooze =
    input.followUpAt && snoozedOn !== null && snoozedOn >= reference.getTime()
      ? input.followUpAt.getTime()
      : Number.NEGATIVE_INFINITY;
  const dueAt = Math.max(base, snooze);
  return dueAt <= today.getTime()
    ? { due: true, dueSince: new Date(dueAt) }
    : { due: false, dueSince: null };
}
