import { GMAIL_FORWARDING_PARSER } from "@job-search-os/pipeline";
import { and, isNotNull, isNull, not, sql, type SQL } from "drizzle-orm";
import { inboundEmails as e } from "../schema";

/**
 * Pestañas de /inbox como condiciones SQL (ronda 19). `needsAttention`
 * (packages/pipeline/src/inbox-attention.ts) es la regla en código; esto es la misma regla para la
 * consulta, y el test de integración `inbox-views.integration.test.ts` comprueba que coinciden.
 *
 * - Pendientes: no visto, no descartado y necesita intervención.
 * - Vistos: no descartado y (visto a mano o resuelto solo, es decir, sin necesitar intervención).
 * - Descartados: con `dismissed_at`.
 * Así cada email cae en exactamente una pestaña y ninguno queda solo en «Todos».
 */
export const inboxAttention: SQL = sql`(${e.error} is not null or ${e.parser} is null or ${e.parser} in ('none', ${GMAIL_FORWARDING_PARSER}))`;

export const inboxWhere = {
  pendientes: and(isNull(e.seenAt), isNull(e.dismissedAt), inboxAttention) as SQL,
  vistos: sql`(${e.dismissedAt} is null and (${e.seenAt} is not null or ${not(inboxAttention)}))`,
  descartados: isNotNull(e.dismissedAt) as SQL,
};
