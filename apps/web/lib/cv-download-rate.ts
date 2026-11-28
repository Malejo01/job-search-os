import { decideCvDownload } from "@job-search-os/pipeline";

/**
 * Ritmo de descarga del CV (R33-08): marcas de tiempo por persona en memoria del proceso. La decisión es
 * pura (`decideCvDownload`, en `packages/pipeline`); acá solo está el almacén. Es un freno de mejor
 * esfuerzo: en un entorno sin servidor cada instancia lleva su cuenta. Sin tabla, a propósito (no hay
 * migración en esta tarea). Cuida también la memoria: tope de personas guardadas.
 */
const MAX_PEOPLE = 5000;
const marks = new Map<string, number[]>();

export function cvDownloadAllowed(
  userId: string,
  now = Date.now(),
): { allowed: true } | { allowed: false; retryAfterSeconds: number } {
  const decision = decideCvDownload(marks.get(userId) ?? [], now);
  if (!decision.allowed) return { allowed: false, retryAfterSeconds: decision.retryAfterSeconds };
  if (!marks.has(userId) && marks.size >= MAX_PEOPLE) {
    // Se descarta la más antigua (el Map conserva el orden de inserción)
    const oldest = marks.keys().next().value;
    if (oldest !== undefined) marks.delete(oldest);
  }
  marks.delete(userId);
  marks.set(userId, decision.kept);
  return { allowed: true };
}

/** Solo para las pruebas. */
export function resetCvDownloadRate(): void {
  marks.clear();
}
