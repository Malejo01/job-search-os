import { schema as s } from "@job-search-os/db";
import { baseDomain } from "@job-search-os/pipeline";
import { sql } from "drizzle-orm";
import { HOST_SQL } from "./filter-leak";
import { withUser } from "./db";

/**
 * Ajustes › Remitentes: los dominios con decisión guardada del usuario y los que le llegaron sin
 * decisión, con cuántos emails y cuándo fue el último. Todo con el rol de la app y RLS.
 */
export type SenderRow = {
  domain: string;
  /** `empleo`, `no_empleo` o null = sin decidir. */
  verdict: string | null;
  emails: number;
  lastAt: Date | null;
};

export async function listSenders(userId: string): Promise<SenderRow[]> {
  return withUser(userId, async (tx) => {
    const hosts = await tx
      .select({
        host: HOST_SQL,
        emails: sql<number>`count(*)::int`,
        lastAt: sql<Date>`max(${s.inboundEmails.receivedAt})`,
      })
      .from(s.inboundEmails)
      .groupBy(HOST_SQL);
    const verdicts = await tx
      .select({ domain: s.inboundSenderDomains.domain, verdict: s.inboundSenderDomains.verdict })
      .from(s.inboundSenderDomains);

    const byDomain = new Map<string, SenderRow>();
    for (const v of verdicts) {
      byDomain.set(v.domain, { domain: v.domain, verdict: v.verdict, emails: 0, lastAt: null });
    }
    for (const h of hosts) {
      if (!h.host) continue;
      const domain = baseDomain(h.host);
      const row = byDomain.get(domain) ?? { domain, verdict: null, emails: 0, lastAt: null };
      const last = new Date(h.lastAt);
      row.emails += Number(h.emails);
      if (!row.lastAt || last > row.lastAt) row.lastAt = last;
      byDomain.set(domain, row);
    }
    // Primero los que tienen emails más recientes; los que solo tienen decisión, al final
    return [...byDomain.values()].sort(
      (a, b) =>
        (b.lastAt?.getTime() ?? 0) - (a.lastAt?.getTime() ?? 0) || a.domain.localeCompare(b.domain),
    );
  });
}
