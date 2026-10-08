import { inboxAttention, inboxWhere, schema as s } from "@job-search-os/db";
import { pgBlobStorage } from "@job-search-os/adapters";
import {
  assessInboxVolume,
  GMAIL_FORWARDING_PARSER,
  gmailConfirmLink,
  gmailForwardRequester,
  type InboxVolume,
} from "@job-search-os/pipeline";
import type { PgColumn } from "drizzle-orm/pg-core";
import { and, desc, eq, gte, inArray, isNull, not, sql } from "drizzle-orm";
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

/**
 * Las pestañas salen de `inboxWhere` (packages/db/src/inbox-views.ts), la regla de
 * `needsAttention` escrita en SQL y probada contra ella. Un email con avisos extraídos y sin error
 * no necesita intervención, tenga o no `seen_at`: los viejos salen de Pendientes y pasan a Vistos
 * solos, sin tocar datos.
 */
const VIEW_WHERE = {
  pendientes: inboxWhere.pendientes,
  vistos: inboxWhere.vistos,
  descartados: inboxWhere.descartados,
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
  /** Solo estos emails (los de un dominio, JS-048); undefined = todos. */
  only?: string[],
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
      .where(
        and(
          VIEW_WHERE[view],
          only ? (only.length ? inArray(s.inboundEmails.id, only) : sql`false`) : undefined,
        ),
      )
      .orderBy(desc(s.inboundEmails.receivedAt))
      .limit(INBOX_LIMIT);
    const [c] = await tx
      .select({
        pendientes: sql<number>`count(*) filter (where ${inboxWhere.pendientes})::int`,
        vistos: sql<number>`count(*) filter (where ${inboxWhere.vistos})::int`,
        descartados: sql<number>`count(*) filter (where ${inboxWhere.descartados})::int`,
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

/** Acciones en lote que se pueden deshacer; "delete" no está: borra de verdad. */
export const REVERSIBLE_BULK = ["seen", "dismiss", "restore_seen", "restore_pending"] as const;
export type ReversibleBulk = (typeof REVERSIBLE_BULK)[number];

type Marks = { seenAt: string | null; dismissedAt: string | null };

/**
 * Para deshacer una acción en lote (fechas en ISO): el estado de un email antes (`seenAt`,
 * `dismissedAt`) y el que dejó la acción (`after`). «Deshacer» solo restaura si el estado actual
 * sigue siendo `after`; si cambió después, no lo pisa.
 */
export type InboxPrevious = Marks & { id: string; after: Marks };

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/**
 * Acción en lote por id (no por posición): aplica `kind` a esos ids y devuelve el estado anterior
 * de cada uno. "Volver a vistos" saca solo `dismissed_at` (y deja visto); "Volver a pendientes"
 * saca las dos marcas. Todo en una transacción y con RLS.
 */
export async function bulkApply(
  userId: string,
  kind: ReversibleBulk,
  ids: readonly string[],
): Promise<{ n: number; previous: InboxPrevious[]; stay: number }> {
  const list = cleanIds(ids);
  if (!list.length) return { n: 0, previous: [], stay: 0 };
  return withUser(userId, async (tx) => {
    const before = await tx
      .select({
        id: s.inboundEmails.id,
        seenAt: s.inboundEmails.seenAt,
        dismissedAt: s.inboundEmails.dismissedAt,
      })
      .from(s.inboundEmails)
      .where(these(list));
    const found = before.map((b) => b.id);
    if (!found.length) return { n: 0, previous: [], stay: 0 };
    const set = {
      seen: { seenAt: sql`coalesce(${s.inboundEmails.seenAt}, now())` },
      dismiss: { dismissedAt: sql`coalesce(${s.inboundEmails.dismissedAt}, now())` },
      restore_seen: {
        seenAt: sql`coalesce(${s.inboundEmails.seenAt}, now())`,
        dismissedAt: null,
      },
      restore_pending: { seenAt: null, dismissedAt: null },
    }[kind];
    const after = await tx.update(s.inboundEmails).set(set).where(these(found)).returning({
      id: s.inboundEmails.id,
      seenAt: s.inboundEmails.seenAt,
      dismissedAt: s.inboundEmails.dismissedAt,
    });
    const afterById = new Map(after.map((a) => [a.id, a]));
    // «Volver a pendientes» deja fuera de Pendientes a los que ya tienen avisos cargados y no
    // requieren intervención: quedan en «Todos». El aviso de la barra lo dice.
    let stay = 0;
    if (kind === "restore_pending") {
      const [c] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(s.inboundEmails)
        .where(and(these(found), not(inboxAttention)));
      stay = c?.n ?? 0;
    }
    return {
      n: found.length,
      stay,
      previous: before.map((b) => ({
        id: b.id,
        seenAt: iso(b.seenAt),
        dismissedAt: iso(b.dismissedAt),
        after: {
          seenAt: iso(afterById.get(b.id)?.seenAt ?? null),
          dismissedAt: iso(afterById.get(b.id)?.dismissedAt ?? null),
        },
      })),
    };
  });
}

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

/** Fecha ISO estricta y razonable → Date; null → null; cualquier otra cosa → undefined (se ignora). */
function parseMark(value: unknown): Date | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string" || !ISO_UTC.test(value)) return undefined;
  const d = new Date(value);
  const year = d.getUTCFullYear();
  return Number.isNaN(d.getTime()) || year < 2000 || year > 2100 ? undefined : d;
}

/** Igualdad al milisegundo (JS no guarda microsegundos) y tratando null como valor. */
const sameMark = (col: PgColumn, d: Date | null) =>
  d === null
    ? sql`${col} is null`
    : sql`date_trunc('milliseconds', ${col}) = ${d.toISOString()}::timestamptz`;

/**
 * «Deshacer»: devuelve a cada id el estado que tenía antes, y solo a esos ids. Cada fila se
 * restaura únicamente si su estado actual sigue siendo el que dejó la acción: si la persona la
 * tocó después, no se pisa. Una entrada mal formada o con fecha inválida se ignora (nunca falla).
 * `user_id` va explícito además de RLS.
 */
export async function undoBulk(
  userId: string,
  previous: readonly InboxPrevious[],
): Promise<number> {
  const entries: {
    id: string;
    prev: [Date | null, Date | null];
    after: [Date | null, Date | null];
  }[] = [];
  for (const p of previous) {
    if (typeof p !== "object" || p === null || typeof p.after !== "object" || p.after === null) {
      continue;
    }
    const marks = [
      parseMark(p.seenAt),
      parseMark(p.dismissedAt),
      parseMark(p.after.seenAt),
      parseMark(p.after.dismissedAt),
    ];
    if (typeof p.id !== "string" || !UUID.test(p.id) || marks.some((m) => m === undefined))
      continue;
    const [prevSeen, prevDismissed, afterSeen, afterDismissed] = marks as (Date | null)[];
    entries.push({
      id: p.id,
      prev: [prevSeen ?? null, prevDismissed ?? null],
      after: [afterSeen ?? null, afterDismissed ?? null],
    });
  }
  const unique = [...new Map(entries.map((e) => [e.id, e])).values()].slice(0, BULK_LIMIT);
  if (!unique.length) return 0;
  return withUser(userId, async (tx) => {
    let n = 0;
    for (const e of unique) {
      const rows = await tx
        .update(s.inboundEmails)
        .set({ seenAt: e.prev[0], dismissedAt: e.prev[1] })
        .where(
          and(
            eq(s.inboundEmails.id, e.id),
            eq(s.inboundEmails.userId, userId),
            sameMark(s.inboundEmails.seenAt, e.after[0]),
            sameMark(s.inboundEmails.dismissedAt, e.after[1]),
          ),
        )
        .returning({ id: s.inboundEmails.id });
      n += rows.length;
    }
    return n;
  });
}

/** La confirmación de reenvío de Gmail que sigue sin verse, con su link de confirmación (o null). */
export type GmailConfirmation = {
  id: string;
  link: string | null;
  /** Cuenta de Gmail que pidió el reenvío, si el cuerpo la dice. */
  requester: string | null;
};

export async function pendingGmailConfirmation(userId: string): Promise<GmailConfirmation | null> {
  return withUser(userId, async (tx) => {
    const [row] = await tx
      .select({ id: s.inboundEmails.id, rawRef: s.inboundEmails.rawRef })
      .from(s.inboundEmails)
      .where(
        and(
          eq(s.inboundEmails.parser, GMAIL_FORWARDING_PARSER),
          isNull(s.inboundEmails.seenAt),
          isNull(s.inboundEmails.dismissedAt),
        ),
      )
      .orderBy(desc(s.inboundEmails.receivedAt))
      .limit(1);
    if (!row) return null;
    const blob = await pgBlobStorage(tx).get(row.rawRef);
    let text: string | null = null;
    let html: string | null = null;
    if (blob) {
      try {
        const parsed = JSON.parse(blob.body) as {
          content?: { html?: string | null; text?: string | null } | null;
        };
        text = parsed.content?.text ?? null;
        html = parsed.content?.html ?? null;
      } catch {
        text = blob.body;
      }
    }
    // El link se calcula en el servidor sobre el cuerpo guardado; acá no se abre nada
    return {
      id: row.id,
      link: gmailConfirmLink(text, html),
      requester: gmailForwardRequester(text, html),
    };
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
