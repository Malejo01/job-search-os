import { schema as s } from "@job-search-os/db";
import {
  ALERT_PORTALS,
  portalOfSender,
  portalStatus,
  type AlertPortalId,
  type PortalStatus,
} from "@job-search-os/pipeline";
import { gte, max } from "drizzle-orm";
import { withUser } from "./db";

/** Ventana de lectura: lo más viejo que esto cuenta como «nunca» (no hay «⚠️» más allá de 180 días). */
const WINDOW_DAYS = 180;

export type PortalCoverage = Record<
  AlertPortalId,
  { status: PortalStatus; lastReceivedAt: Date | null }
>;

/**
 * Estado de cada portal según los mails que llegaron (guía de alertas, ronda 108). Una sola consulta
 * con RLS: último `received_at` por remitente de los últimos 180 días; el portal se deduce del
 * remitente en código (`inbound_emails` no tiene columna de portal). Los avisos que la persona
 * reenvía a mano desde otro correo pueden figurar como «nunca». No guarda nada ni abre links.
 */
export async function portalCoverage(userId: string, now: Date): Promise<PortalCoverage> {
  const since = new Date(now.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const rows = await withUser(userId, (tx) =>
    tx
      .select({ from: s.inboundEmails.fromAddress, last: max(s.inboundEmails.receivedAt) })
      .from(s.inboundEmails)
      .where(gte(s.inboundEmails.receivedAt, since))
      .groupBy(s.inboundEmails.fromAddress),
  );
  const last = new Map<AlertPortalId, Date>();
  for (const row of rows) {
    if (!row.last) continue;
    const portal = portalOfSender(row.from);
    if (!portal) continue;
    const prev = last.get(portal);
    if (!prev || row.last > prev) last.set(portal, row.last);
  }
  const out = {} as PortalCoverage;
  for (const p of ALERT_PORTALS) {
    const lastReceivedAt = last.get(p.id) ?? null;
    out[p.id] = { status: portalStatus(lastReceivedAt, now), lastReceivedAt };
  }
  return out;
}
