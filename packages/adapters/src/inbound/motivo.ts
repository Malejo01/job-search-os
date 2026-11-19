/**
 * Los motivos de error de los parsers acaban en `inbound_emails.error` y en el log: nunca llevan más
 * que esto, aunque el motivo cite texto del email (un título, un slug, una línea de contrato).
 */
export const MAX_REASON_CHARS = 120;

/** Recorta un motivo al máximo y marca el corte con «…». Un motivo corto queda igual. */
export function clampReason(reason: string): string {
  return reason.length <= MAX_REASON_CHARS ? reason : `${reason.slice(0, MAX_REASON_CHARS - 1)}…`;
}
