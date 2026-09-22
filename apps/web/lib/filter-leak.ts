import { schema as s } from "@job-search-os/db";
import { baseDomain, detectFilterLeaks, type FilterLeak } from "@job-search-os/pipeline";
import { sql } from "drizzle-orm";
import { withUser } from "./db";
import { deleteInbound } from "./inbox-list";

/**
 * Aviso de posible fuga del filtro de reenvío en /inbox (JS-048). La regla está en el pipeline
 * (detectFilterLeaks); acá se juntan los remitentes por host y las decisiones de la persona.
 * Todo con el rol de la app y RLS.
 */

/** Host del remitente en SQL: "Banco <a@mails.banco.com.ar>" → "mails.banco.com.ar". */
const HOST_SQL = sql<string>`lower(split_part(regexp_replace(${s.inboundEmails.fromAddress}, '^.*<([^>]+)>.*$', '\\1'), '@', 2))`;

export const SENDER_VERDICTS = ["empleo", "no_empleo"] as const;
export type SenderVerdict = (typeof SENDER_VERDICTS)[number];

export async function filterLeaks(userId: string, now = new Date()): Promise<FilterLeak[]> {
  const since = new Date(now.getTime() - 48 * 3_600_000);
  return withUser(userId, async (tx) => {
    const hosts = await tx
      .select({
        host: HOST_SQL,
        firstAt: sql<Date>`min(${s.inboundEmails.receivedAt})`,
        lastAt: sql<Date>`max(${s.inboundEmails.receivedAt})`,
        recent: sql<number>`(count(*) filter (where ${s.inboundEmails.receivedAt} >= ${since.toISOString()}::timestamptz))::int`,
      })
      .from(s.inboundEmails)
      .groupBy(HOST_SQL);
    const verdicts = await tx
      .select({ domain: s.inboundSenderDomains.domain, verdict: s.inboundSenderDomains.verdict })
      .from(s.inboundSenderDomains);
    return detectFilterLeaks({
      now,
      hosts: hosts
        .filter((h) => h.host)
        .map((h) => ({
          host: h.host,
          firstAt: new Date(h.firstAt),
          lastAt: new Date(h.lastAt),
          recent: Number(h.recent),
        })),
      userVerdicts: Object.fromEntries(
        verdicts
          .filter((v) => (SENDER_VERDICTS as readonly string[]).includes(v.verdict))
          .map((v) => [v.domain, v.verdict as SenderVerdict]),
      ),
    });
  });
}

/** Dominio base válido (lo que llega del formulario); null si no parece un dominio. */
export function cleanDomain(raw: string): string | null {
  const d = baseDomain(raw);
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d) ? d : null;
}

/** "Es fuente de empleo" / "No es de empleo": deja de avisar por ese dominio. */
export async function setSenderVerdict(
  userId: string,
  domain: string,
  verdict: SenderVerdict,
): Promise<void> {
  await withUser(userId, (tx) =>
    tx
      .insert(s.inboundSenderDomains)
      .values({ userId, domain, verdict })
      .onConflictDoUpdate({
        target: [s.inboundSenderDomains.userId, s.inboundSenderDomains.domain],
        set: { verdict, createdAt: new Date() },
      }),
  );
}

/** Ids de los emails de un dominio base (con cualquier subdominio), de cualquier pestaña. */
export async function emailIdsOfDomain(userId: string, domain: string): Promise<string[]> {
  return withUser(userId, async (tx) => {
    const rows = await tx
      .select({ id: s.inboundEmails.id, host: HOST_SQL })
      .from(s.inboundEmails)
      .where(sql`${HOST_SQL} = ${domain} or ${HOST_SQL} like ${`%.${domain}`}`);
    return rows.filter((r) => baseDomain(r.host) === domain).map((r) => r.id);
  });
}

/** "Eliminar todos los de este dominio": misma regla que borrar de a uno (el crudo con aviso queda). */
export async function deleteDomainEmails(userId: string, domain: string): Promise<number> {
  const ids = await emailIdsOfDomain(userId, domain);
  let deleted = 0;
  for (let i = 0; i < ids.length; i += 200) {
    deleted += (await deleteInbound(userId, ids.slice(i, i + 200))).deleted;
  }
  return deleted;
}
