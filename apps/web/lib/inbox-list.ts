import { schema as s } from "@job-search-os/db";
import { assessInboxVolume, type InboxVolume } from "@job-search-os/pipeline";
import { and, desc, eq, gte, isNotNull, isNull, sql } from "drizzle-orm";
import { withUser } from "./db";

/**
 * Lista y acciones de /inbox (JS-038). "Visto" y "no me sirve" solo sacan el email de la vista
 * por defecto (quedan en la base); "eliminar" es lo único que borra. Todo con el rol de la app
 * y RLS: cada usuario solo toca sus emails.
 */
export const INBOX_VIEWS = ["pendientes", "vistos", "descartados", "todos"] as const;
export type InboxView = (typeof INBOX_VIEWS)[number];

export function parseInboxView(raw: string | undefined): InboxView {
  return (INBOX_VIEWS as readonly string[]).includes(raw ?? "") ? (raw as InboxView) : "pendientes";
}

const VIEW_WHERE = {
  pendientes: and(isNull(s.inboundEmails.seenAt), isNull(s.inboundEmails.dismissedAt)),
  vistos: and(isNotNull(s.inboundEmails.seenAt), isNull(s.inboundEmails.dismissedAt)),
  descartados: isNotNull(s.inboundEmails.dismissedAt),
  todos: undefined,
} as const;

export type InboxRow = {
  id: string;
  from: string;
  subject: string | null;
  parser: string | null;
  jobs: number | null;
  error: string | null;
  receivedAt: Date;
  seen: boolean;
  dismissed: boolean;
};

export const INBOX_LIMIT = 50;

export async function listInbox(
  userId: string,
  view: InboxView,
): Promise<{ rows: InboxRow[]; counts: Record<InboxView, number> }> {
  return withUser(userId, async (tx) => {
    const rows = await tx
      .select({
        id: s.inboundEmails.id,
        from: s.inboundEmails.fromAddress,
        subject: s.inboundEmails.subject,
        parser: s.inboundEmails.parser,
        jobs: s.inboundEmails.jobsExtracted,
        error: s.inboundEmails.error,
        receivedAt: s.inboundEmails.receivedAt,
        seenAt: s.inboundEmails.seenAt,
        dismissedAt: s.inboundEmails.dismissedAt,
      })
      .from(s.inboundEmails)
      .where(VIEW_WHERE[view])
      .orderBy(desc(s.inboundEmails.receivedAt))
      .limit(INBOX_LIMIT);
    const [c] = await tx
      .select({
        pendientes: sql<number>`count(*) filter (where seen_at is null and dismissed_at is null)::int`,
        vistos: sql<number>`count(*) filter (where seen_at is not null and dismissed_at is null)::int`,
        descartados: sql<number>`count(*) filter (where dismissed_at is not null)::int`,
        todos: sql<number>`count(*)::int`,
      })
      .from(s.inboundEmails);
    return {
      rows: rows.map(({ seenAt, dismissedAt, ...r }) => ({
        ...r,
        seen: seenAt !== null,
        dismissed: dismissedAt !== null,
      })),
      counts: c ?? { pendientes: 0, vistos: 0, descartados: 0, todos: 0 },
    };
  });
}

export type InboxVolumeView = InboxVolume & {
  last24h: number;
  last24hNoParser: number;
  rejectedLast24h: number;
};

/** Conteos de volumen (24 h, sin parser, rechazados, 7 días previos) y el diagnóstico del pipeline. */
export async function inboxVolume(userId: string, now = new Date()): Promise<InboxVolumeView> {
  return withUser(userId, async (tx) => {
    const day = 24 * 60 * 60 * 1000;
    const since = new Date(now.getTime() - day);
    const [last] = await tx
      .select({
        total: sql<number>`count(*)::int`,
        noParser: sql<number>`count(*) filter (where ${s.inboundEmails.parser} is null or ${s.inboundEmails.parser} = 'none')::int`,
      })
      .from(s.inboundEmails)
      .where(gte(s.inboundEmails.receivedAt, since));
    const [rej] = await tx
      .select({ n: sql<number>`coalesce(sum(${s.inboundRejections.rejected}), 0)::int` })
      .from(s.inboundRejections)
      .where(gte(s.inboundRejections.lastAt, since));
    // Recibidos por día en los 7 días anteriores a las últimas 24 h (con ceros)
    const prev = await tx.execute<{ k: number; n: number }>(sql`
      select k, (select count(*)::int from inbound_emails
                 where received_at >= ${now.toISOString()}::timestamptz - make_interval(days => k + 1)
                   and received_at <  ${now.toISOString()}::timestamptz - make_interval(days => k)) as n
      from generate_series(1, 7) as k
    `);
    const input = {
      last24h: last?.total ?? 0,
      last24hNoParser: last?.noParser ?? 0,
      rejectedLast24h: rej?.n ?? 0,
      previousDays: [...prev].map((r) => Number(r.n)),
    };
    return { ...input, ...assessInboxVolume(input) };
  });
}

const mine = (id: string) => eq(s.inboundEmails.id, id);

export async function markInboundSeen(userId: string, id: string): Promise<void> {
  await withUser(userId, (tx) =>
    tx.update(s.inboundEmails).set({ seenAt: new Date() }).where(mine(id)),
  );
}

export async function dismissInbound(userId: string, id: string): Promise<void> {
  await withUser(userId, (tx) =>
    tx.update(s.inboundEmails).set({ dismissedAt: new Date() }).where(mine(id)),
  );
}

/** Vuelve a pendientes: saca las marcas de visto y de descartado. */
export async function restoreInbound(userId: string, id: string): Promise<void> {
  await withUser(userId, (tx) =>
    tx.update(s.inboundEmails).set({ seenAt: null, dismissedAt: null }).where(mine(id)),
  );
}

/**
 * Borra el email. Su crudo se borra solo si nadie más lo usa: los avisos extraídos de ese email
 * lo tienen como fuente (job_sources.raw_ref, JS-024) y perderlo dejaría esos avisos sin
 * evidencia. Devuelve si el crudo se borró.
 */
export async function deleteInbound(userId: string, id: string): Promise<{ rawDeleted: boolean }> {
  return withUser(userId, async (tx) => {
    const [row] = await tx
      .delete(s.inboundEmails)
      .where(mine(id))
      .returning({ rawRef: s.inboundEmails.rawRef });
    if (!row) return { rawDeleted: false };
    const [usedByJob] = await tx
      .select({ id: s.jobSources.id })
      .from(s.jobSources)
      .where(eq(s.jobSources.rawRef, row.rawRef))
      .limit(1);
    const [usedByEmail] = await tx
      .select({ id: s.inboundEmails.id })
      .from(s.inboundEmails)
      .where(eq(s.inboundEmails.rawRef, row.rawRef))
      .limit(1);
    if (usedByJob || usedByEmail || !row.rawRef.startsWith("pg:")) return { rawDeleted: false };
    await tx.delete(s.rawBlobs).where(eq(s.rawBlobs.id, row.rawRef.slice(3)));
    return { rawDeleted: true };
  });
}
