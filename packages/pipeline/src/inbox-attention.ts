/**
 * Qué emails entrantes necesitan intervención de la persona (ronda 19). Es la definición de
 * "Pendientes" en /inbox: lo demás se resuelve solo al llegar (avisos extraídos, seguridad,
 * postulaciones). La consulta de apps/web/lib/inbox-list.ts escribe esta misma regla en SQL
 * (para paginar y contar); el test de acá es su especificación.
 */
import { GMAIL_FORWARDING_PARSER } from "./inbound-classify";

export type AttentionRow = {
  parser: string | null;
  jobsExtracted: number | null;
  error: string | null;
  seenAt: Date | null;
  dismissedAt: Date | null;
};

export function needsAttention(row: AttentionRow): boolean {
  if (row.seenAt !== null || row.dismissedAt !== null) return false;
  if (row.error !== null) return true; // cola manual: estructura no reconocida o remitente no esperado
  if (row.parser === null || row.parser === "none") return true; // sin parser
  return row.parser === GMAIL_FORWARDING_PARSER; // hay que confirmar el reenvío
}
