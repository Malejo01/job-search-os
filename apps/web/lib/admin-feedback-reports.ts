import {
  ATTACHMENT_PURGE_DAYS,
  isFeedbackStatus,
  isReportStatus,
  type ExportAttachment,
  type FeedbackStatus,
  type ReportStatus,
} from "@job-search-os/pipeline";
import { sql } from "drizzle-orm";
import { withUser } from "./db";
import { canCreateInvitations } from "./invitations";

/**
 * Informes de revisión para el admin (R29-05), solo servidor y solo admins. Dos barreras: `ADMIN_EMAILS` acá y
 * `app_admins` en la base (`admin_feedback_reports`, `admin_feedback_report` en rls/0069 y
 * `admin_feedback_item_set_status` en rls/0070). La persona sale con su identificador seudónimo de 6 caracteres:
 * nunca email ni nombre. Los borradores no se ven.
 */

export type ReportListRow = {
  id: string;
  person: string;
  status: ReportStatus;
  sentAt: Date | null;
  items: number;
  screenshots: number;
  documents: number;
  itemsNew: number;
};

export type ReportDetailItem = {
  id: string;
  position: number;
  path: string;
  category: string;
  message: string;
  status: FeedbackStatus;
  attachments: ExportAttachment[];
};

export type ReportDetail = {
  id: string;
  person: string;
  status: ReportStatus;
  sentAt: Date | null;
  items: ReportDetailItem[];
};

type RawList = {
  id: string;
  person: string;
  status: string;
  sent_at: Date | string | null;
  items: number | string;
  screenshots: number | string;
  documents: number | string;
  items_new: number | string;
};

export type RawDetail = {
  report_id: string;
  person: string;
  report_status: string;
  sent_at: Date | string | null;
  item_id: string;
  item_position: number | string;
  path: string;
  category: string;
  message: string;
  item_status: string;
  attachment_id: string | null;
  attachment_name: string | null;
  attachment_kind: string | null;
  attachment_bytes: number | string | null;
  attachment_width: number | string | null;
  attachment_height: number | string | null;
};

const toDate = (v: Date | string | null): Date | null => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};
const toInt = (v: number | string | null | undefined): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : 0;
};
const toNullableInt = (v: number | string | null | undefined): number | null =>
  v === null || v === undefined ? null : toInt(v);

export function mapReportList(raw: readonly RawList[]): ReportListRow[] {
  return raw.map((r) => ({
    id: r.id,
    person: r.person,
    status: isReportStatus(r.status) ? r.status : "enviado",
    sentAt: toDate(r.sent_at),
    items: toInt(r.items),
    screenshots: toInt(r.screenshots),
    documents: toInt(r.documents),
    itemsNew: toInt(r.items_new),
  }));
}

/** Junta las filas «una por adjunto» de `admin_feedback_report` en un informe con sus ítems en orden. */
export function groupReportRows(raw: readonly RawDetail[]): ReportDetail | null {
  const first = raw[0];
  if (!first) return null;
  const items = new Map<string, ReportDetailItem>();
  for (const r of raw) {
    let item = items.get(r.item_id);
    if (!item) {
      item = {
        id: r.item_id,
        position: toInt(r.item_position),
        path: r.path,
        category: r.category,
        message: r.message,
        status: isFeedbackStatus(r.item_status) ? r.item_status : "nuevo",
        attachments: [],
      };
      items.set(r.item_id, item);
    }
    const kind = r.attachment_kind;
    if (r.attachment_id && (kind === "image" || kind === "pdf" || kind === "docx")) {
      item.attachments.push({
        id: r.attachment_id,
        name: r.attachment_name ?? "adjunto",
        kind,
        bytes: toInt(r.attachment_bytes),
        width: toNullableInt(r.attachment_width),
        height: toNullableInt(r.attachment_height),
      });
    }
  }
  return {
    id: first.report_id,
    person: first.person,
    status: isReportStatus(first.report_status) ? first.report_status : "enviado",
    sentAt: toDate(first.sent_at),
    items: [...items.values()].sort((a, b) => a.position - b.position),
  };
}

export type ReportsResult =
  { ok: true; rows: ReportListRow[] } | { ok: false; reason: "no_admin" | "sin_datos" };

export async function listFeedbackReports(userId: string): Promise<ReportsResult> {
  if (!(await canCreateInvitations(userId))) return { ok: false, reason: "no_admin" };
  try {
    const raw = (await withUser(userId, (tx) =>
      tx.execute(sql`select * from admin_feedback_reports(100)`),
    )) as unknown as RawList[];
    return { ok: true, rows: mapReportList(Array.from(raw)) };
  } catch {
    return { ok: false, reason: "sin_datos" };
  }
}

export type ReportResult =
  | { ok: true; report: ReportDetail }
  | { ok: false; reason: "no_admin" | "no_existe" | "sin_datos" };

export async function getFeedbackReport(userId: string, id: string): Promise<ReportResult> {
  if (!(await canCreateInvitations(userId))) return { ok: false, reason: "no_admin" };
  try {
    const raw = (await withUser(userId, (tx) =>
      tx.execute(sql`select * from admin_feedback_report(${id}::uuid)`),
    )) as unknown as RawDetail[];
    const report = groupReportRows(Array.from(raw));
    return report ? { ok: true, report } : { ok: false, reason: "no_existe" };
  } catch {
    return { ok: false, reason: "sin_datos" };
  }
}

export async function setReportItemStatus(
  userId: string,
  itemId: string,
  status: FeedbackStatus,
): Promise<boolean> {
  if (!(await canCreateInvitations(userId))) return false;
  const rows = (await withUser(userId, (tx) =>
    tx.execute(sql`select admin_feedback_item_set_status(${itemId}::uuid, ${status}) as ok`),
  )) as unknown as { ok: boolean }[];
  return rows[0]?.ok === true;
}

// ---------------------------------------------------------------------------------------------------------
// Limpieza de adjuntos de lo resuelto (R29-09, rls/0070 `purge_resolved_attachments`)
// ---------------------------------------------------------------------------------------------------------

export type PurgeSummary = { files: number; bytes: number };

async function runPurge(
  userId: string,
  days: number,
  itemId: string | null,
  dryRun: boolean,
): Promise<PurgeSummary | null> {
  if (!(await canCreateInvitations(userId))) return null;
  try {
    const rows = (await withUser(userId, (tx) =>
      tx.execute(
        sql`select * from purge_resolved_attachments(${days}::integer, ${itemId}::uuid, ${dryRun})`,
      ),
    )) as unknown as { files_deleted: number; bytes_freed: number | string }[];
    return { files: toInt(rows[0]?.files_deleted), bytes: toInt(rows[0]?.bytes_freed) };
  } catch {
    return null;
  }
}

/** Cuántos archivos y bytes borraría la limpieza de lo resuelto hace 30 días o más (no borra nada). */
export const previewPurgeResolved = (userId: string) =>
  runPurge(userId, ATTACHMENT_PURGE_DAYS, null, true);

/** Borra ahora los adjuntos de lo resuelto hace 30 días o más. `null` si no es admin o la base falla. */
export const purgeResolvedNow = (userId: string) =>
  runPurge(userId, ATTACHMENT_PURGE_DAYS, null, false);

/** Borra los adjuntos de un ítem ya resuelto, sin esperar los 30 días. */
export const purgeItemAttachments = (userId: string, itemId: string) =>
  runPurge(userId, 0, itemId, false);

export type DeletedAttachment = { itemId: string; name: string; bytes: number; deletedAt: Date };

/** Los adjuntos ya borrados de un informe, para mostrar «Adjunto borrado el …» en lugar del archivo. */
export async function listDeletedAttachments(
  userId: string,
  reportId: string,
): Promise<DeletedAttachment[]> {
  if (!(await canCreateInvitations(userId))) return [];
  try {
    const rows = (await withUser(userId, (tx) =>
      tx.execute(sql`select * from admin_feedback_deleted_attachments(${reportId}::uuid)`),
    )) as unknown as {
      item_id: string;
      attachment_name: string;
      attachment_bytes: number | string;
      deleted_at: Date | string;
    }[];
    return Array.from(rows).flatMap((r) => {
      const deletedAt = toDate(r.deleted_at);
      return deletedAt
        ? [
            {
              itemId: r.item_id,
              name: r.attachment_name,
              bytes: toInt(r.attachment_bytes),
              deletedAt,
            },
          ]
        : [];
    });
  } catch {
    return [];
  }
}
