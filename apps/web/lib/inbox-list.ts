import { schema as s } from "@job-search-os/db";
import { assessInboxVolume, type InboxVolume } from "@job-search-os/pipeline";
import { and, desc, eq, gte, inArray, isNotNull, isNull, sql } from "drizzle-orm";
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

/** Tope por acción en lote: la vista muestra INBOX_LIMIT filas, esto deja margen. */
export const BULK_LIMIT = 200;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ids válidos y sin repetir; lo que no es un uuid se ignora (RLS ya limita al usuario). */
export function cleanIds(ids: readonly string[]): string[] {
  return [...new Set(ids.filter((id) => UUID.test(id)))].slice(0, BULK_LIMIT);
}

const these = (ids: string[]) => inArray(s.inboundEmails.id, ids);

/** Visto (JS-038, en lote JS-049). Un email ya visto conserva la fecha de la primera vez. */
export async function markInboundSeen(userId: string, ids: string | string[]): Promise<number> {
  const list = cleanIds([ids].flat());
  if (!list.length) return 0;
  return withUser(userId, async (tx) => {
    const rows = await tx
      .update(s.inboundEmails)
      .set({ seenAt: sql`coalesce(${s.inboundEmails.seenAt}, now())` })
      .where(these(list))
      .returning({ id: s.inboundEmails.id });
    return rows.length;
  });
}

/** "No me sirve": solo marca `dismissed_at`; no borra nada y se revierte con restoreInbound. */
export async function dismissInbound(userId: string, ids: string | string[]): Promise<number> {
  const list = cleanIds([ids].flat());
  if (!list.length) return 0;
  return withUser(userId, async (tx) => {
    const rows = await tx
      .update(s.inboundEmails)
      .set({ dismissedAt: sql`coalesce(${s.inboundEmails.dismissedAt}, now())` })
      .where(these(list))
      .returning({ id: s.inboundEmails.id });
    return rows.length;
  });
}

/** Vuelve a pendientes: saca las marcas de visto y de descartado. */
export async function restoreInbound(userId: string, ids: string | string[]): Promise<number> {
  const list = cleanIds([ids].flat());
  if (!list.length) return 0;
  return withUser(userId, async (tx) => {
    const rows = await tx
      .update(s.inboundEmails)
      .set({ seenAt: null, dismissedAt: null })
      .where(these(list))
      .returning({ id: s.inboundEmails.id });
    return rows.length;
  });
}

/**
 * Borra los emails, en una sola transacción. El crudo de cada uno se borra solo si nadie más lo
 * usa: los avisos extraídos de ese email lo tienen como fuente (job_sources.raw_ref, JS-024) y
 * perderlo dejaría esos avisos sin evidencia.
 */
export async function deleteInbound(
  userId: string,
  ids: string | string[],
): Promise<{ deleted: number; rawDeleted: number }> {
  const list = cleanIds([ids].flat());
  if (!list.length) return { deleted: 0, rawDeleted: 0 };
  return withUser(userId, async (tx) => {
    const rows = await tx
      .delete(s.inboundEmails)
      .where(these(list))
      .returning({ rawRef: s.inboundEmails.rawRef });
    let rawDeleted = 0;
    for (const rawRef of new Set(rows.map((r) => r.rawRef))) {
      const [usedByJob] = await tx
        .select({ id: s.jobSources.id })
        .from(s.jobSources)
        .where(eq(s.jobSources.rawRef, rawRef))
        .limit(1);
      const [usedByEmail] = await tx
        .select({ id: s.inboundEmails.id })
        .from(s.inboundEmails)
        .where(eq(s.inboundEmails.rawRef, rawRef))
        .limit(1);
      if (usedByJob || usedByEmail || !rawRef.startsWith("pg:")) continue;
      await tx.delete(s.rawBlobs).where(eq(s.rawBlobs.id, rawRef.slice(3)));
      rawDeleted += 1;
    }
    return { deleted: rows.length, rawDeleted };
  });
}
