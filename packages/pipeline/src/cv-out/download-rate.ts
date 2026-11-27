/**
 * Ritmo de descarga del CV (R33-08, C-52/C-54): decisión pura sobre las marcas de tiempo de los intentos
 * recientes de una persona. El almacén de las marcas vive en `apps/web`; acá solo se decide. Falla
 * cerrado: una marca inválida cuenta como intento reciente.
 */
export const CV_DOWNLOADS_PER_MINUTE = 6;
export const CV_DOWNLOADS_PER_HOUR = 40;

export interface CvDownloadDecision {
  allowed: boolean;
  /** Segundos hasta que se libera un cupo (solo si no está permitido). */
  retryAfterSeconds: number;
  /** Marcas que siguen contando (las de la última hora). */
  kept: number[];
}

export function decideCvDownload(attempts: readonly number[], nowMs: number): CvDownloadDecision {
  const hour = 3_600_000;
  const minute = 60_000;
  const kept = attempts
    .map((t) => (Number.isFinite(t) ? t : nowMs))
    .filter((t) => nowMs - t < hour)
    .sort((a, b) => a - b);
  const lastMinute = kept.filter((t) => nowMs - t < minute);
  if (lastMinute.length >= CV_DOWNLOADS_PER_MINUTE) {
    const wait = Math.ceil((lastMinute[0]! + minute - nowMs) / 1000);
    return { allowed: false, retryAfterSeconds: Math.max(1, wait), kept };
  }
  if (kept.length >= CV_DOWNLOADS_PER_HOUR) {
    const wait = Math.ceil((kept[0]! + hour - nowMs) / 1000);
    return { allowed: false, retryAfterSeconds: Math.max(1, wait), kept };
  }
  return { allowed: true, retryAfterSeconds: 0, kept: [...kept, nowMs] };
}
