import { pgBinaryStorage } from "@job-search-os/adapters";
import { schema as s } from "@job-search-os/db";
import {
  REPORT_ITEMS_MAX,
  countReportAttachments,
  validateReportForSend,
  validateReportItem,
  summarizeReport,
  type ReportItemInput,
  type ReportStatus,
} from "@job-search-os/pipeline";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { withUser } from "./db";

/**
 * «Mi informe de revisión» (R29-03), solo servidor. Todo corre en una transacción de la persona (`withUser`): las
 * policies de `rls/0069` hacen el aislamiento y congelan el informe al enviarlo. Las reglas (topes, validación,
 * resumen) son de `packages/pipeline`; acá solo se guarda y se lee. Un lock por persona evita que dos pedidos a la
 * vez creen dos borradores o pasen el tope de ítems.
 */

export type AttachmentView = {
  id: string;
  name: string;
  kind: "image" | "pdf" | "docx";
  bytes: number;
  width: number | null;
  height: number | null;
};

export type ItemView = {
  id: string;
  position: number;
  path: string;
  category: string;
  message: string;
  attachments: AttachmentView[];
};

export type DraftView = { reportId: string; items: ItemView[]; updatedAt: Date };

export type SentReportView = {
  id: string;
  sentAt: Date;
  status: ReportStatus;
  items: number;
  screenshots: number;
  documents: number;
};

type Tx = Parameters<Parameters<typeof withUser>[1]>[0];

const lockReport = (tx: Tx, userId: string) =>
  tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${userId}, 29))`);

/** Se tira dentro de la transacción de `saveItems` para deshacerla entera. */
class ItemLockedError extends Error {
  constructor(readonly itemId: string) {
    super("item_locked");
  }
}

async function attachmentsOf(tx: Tx, itemIds: string[]): Promise<Map<string, AttachmentView[]>> {
  const out = new Map<string, AttachmentView[]>();
  if (itemIds.length === 0) return out;
  const rows = await tx
    .select({
      id: s.feedbackAttachments.id,
      itemId: s.feedbackAttachments.itemId,
      name: s.feedbackAttachments.originalName,
      kind: s.feedbackAttachments.kind,
      bytes: s.feedbackAttachments.bytes,
      width: s.feedbackAttachments.width,
      height: s.feedbackAttachments.height,
    })
    .from(s.feedbackAttachments)
    .where(
      and(inArray(s.feedbackAttachments.itemId, itemIds), isNull(s.feedbackAttachments.deletedAt)),
    )
    .orderBy(asc(s.feedbackAttachments.createdAt), asc(s.feedbackAttachments.id));
  for (const r of rows) {
    const list = out.get(r.itemId) ?? [];
    list.push({
      id: r.id,
      name: r.name,
      kind: r.kind as AttachmentView["kind"],
      bytes: r.bytes,
      width: r.width,
      height: r.height,
    });
    out.set(r.itemId, list);
  }
  return out;
}

async function draftIn(tx: Tx, userId: string): Promise<{ id: string; updatedAt: Date } | null> {
  const [row] = await tx
    .select({ id: s.feedbackReports.id, updatedAt: s.feedbackReports.updatedAt })
    .from(s.feedbackReports)
    .where(and(eq(s.feedbackReports.userId, userId), eq(s.feedbackReports.status, "borrador")))
    .limit(1);
  return row ?? null;
}

/** El borrador de la persona con sus ítems y adjuntos (sin los bytes), o `null` si todavía no armó ninguno. */
export async function loadDraft(userId: string): Promise<DraftView | null> {
  return withUser(userId, async (tx) => {
    const draft = await draftIn(tx, userId);
    if (!draft) return null;
    const items = await tx
      .select({
        id: s.feedbackItems.id,
        position: s.feedbackItems.position,
        path: s.feedbackItems.path,
        category: s.feedbackItems.category,
        message: s.feedbackItems.message,
      })
      .from(s.feedbackItems)
      .where(eq(s.feedbackItems.reportId, draft.id))
      .orderBy(asc(s.feedbackItems.position));
    const attachments = await attachmentsOf(
      tx,
      items.map((i) => i.id),
    );
    return {
      reportId: draft.id,
      updatedAt: draft.updatedAt,
      items: items.map((i) => ({ ...i, attachments: attachments.get(i.id) ?? [] })),
    };
  });
}

/** Los informes que la persona ya envió (los 10 más recientes), con su resumen. */
export async function loadSentReports(userId: string): Promise<SentReportView[]> {
  return withUser(userId, async (tx) => {
    const reports = await tx
      .select({
        id: s.feedbackReports.id,
        sentAt: s.feedbackReports.sentAt,
        status: s.feedbackReports.status,
      })
      .from(s.feedbackReports)
      .where(
        and(eq(s.feedbackReports.userId, userId), sql`${s.feedbackReports.status} <> 'borrador'`),
      )
      .orderBy(sql`${s.feedbackReports.sentAt} desc`)
      .limit(10);
    if (reports.length === 0) return [];
    const ids = reports.map((r) => r.id);
    const items = await tx
      .select({ id: s.feedbackItems.id, reportId: s.feedbackItems.reportId })
      .from(s.feedbackItems)
      .where(inArray(s.feedbackItems.reportId, ids));
    const files = await attachmentsOf(
      tx,
      items.map((i) => i.id),
    );
    return reports.flatMap((r) => {
      if (!r.sentAt) return [];
      const mine = items.filter((i) => i.reportId === r.id);
      const counts = countReportAttachments(mine.flatMap((i) => files.get(i.id) ?? []));
      return [
        {
          id: r.id,
          sentAt: r.sentAt,
          status: r.status as ReportStatus,
          items: mine.length,
          ...counts,
        },
      ];
    });
  });
}

export type AddItemResult =
  { ok: true; item: ItemView } | { ok: false; reason: "invalid" | "too_many" };

/**
 * Suma un ítem al borrador (lo crea si no hay). Toma la primera posición libre de 0 a 29, así un ítem borrado
 * deja su lugar para el siguiente y la base nunca pasa de 30. Con `input` vacío es un ítem en blanco
 * («Agregar ítem»); desde el modal trae pantalla, categoría y texto.
 */
export async function addItem(
  userId: string,
  input: { path?: unknown; category?: unknown; message?: unknown },
): Promise<AddItemResult> {
  const checked = validateReportItem({
    path: input.path ?? "/",
    category: input.category ?? "algo_no_anduvo",
    message: input.message ?? "",
  });
  if (!checked.ok) return { ok: false, reason: "invalid" };
  return withUser(userId, async (tx): Promise<AddItemResult> => {
    await lockReport(tx, userId);
    let draft = await draftIn(tx, userId);
    if (!draft) {
      const [created] = await tx
        .insert(s.feedbackReports)
        .values({ userId })
        .returning({ id: s.feedbackReports.id, updatedAt: s.feedbackReports.updatedAt });
      draft = created!;
    }
    const taken = await tx
      .select({ position: s.feedbackItems.position })
      .from(s.feedbackItems)
      .where(eq(s.feedbackItems.reportId, draft.id));
    if (taken.length >= REPORT_ITEMS_MAX) return { ok: false, reason: "too_many" };
    const used = new Set(taken.map((t) => t.position));
    let position = 0;
    while (used.has(position)) position++;
    const [row] = await tx
      .insert(s.feedbackItems)
      .values({ reportId: draft.id, userId, position, ...checked.value })
      .returning({ id: s.feedbackItems.id });
    await tx
      .update(s.feedbackReports)
      .set({ updatedAt: new Date() })
      .where(eq(s.feedbackReports.id, draft.id));
    return {
      ok: true,
      item: { id: row!.id, position, ...checked.value, attachments: [] },
    };
  });
}

export type SaveItemsResult =
  { ok: true } | { ok: false; reason: "invalid" | "locked"; itemId?: string };

/**
 * Guarda el texto, la pantalla y la categoría de varios ítems del borrador. Falla cerrado: si uno es inválido no
 * se guarda ninguno, y si alguno ya no está en un borrador propio (informe enviado, ítem borrado) devuelve
 * `locked` y deshace todo.
 */
export async function saveItems(
  userId: string,
  items: readonly { id: unknown; path: unknown; category: unknown; message: unknown }[],
): Promise<SaveItemsResult> {
  const valid: { id: string; value: ReportItemInput }[] = [];
  for (const item of items) {
    const checked = validateReportItem(item);
    if (!checked.ok || typeof item.id !== "string") {
      return {
        ok: false,
        reason: "invalid",
        itemId: typeof item.id === "string" ? item.id : undefined,
      };
    }
    valid.push({ id: item.id, value: checked.value });
  }
  if (valid.length === 0) return { ok: true };
  return withUser(userId, async (tx): Promise<SaveItemsResult> => {
    for (const { id, value } of valid) {
      const updated = await tx
        .update(s.feedbackItems)
        .set({ ...value, updatedAt: new Date() })
        .where(and(eq(s.feedbackItems.id, id), eq(s.feedbackItems.userId, userId)))
        .returning({ id: s.feedbackItems.id, reportId: s.feedbackItems.reportId });
      if (updated.length !== 1) throw new ItemLockedError(id);
    }
    const [one] = await tx
      .select({ reportId: s.feedbackItems.reportId })
      .from(s.feedbackItems)
      .where(eq(s.feedbackItems.id, valid[0]!.id))
      .limit(1);
    if (one) {
      await tx
        .update(s.feedbackReports)
        .set({ updatedAt: new Date() })
        .where(eq(s.feedbackReports.id, one.reportId));
    }
    return { ok: true };
  }).catch((e: unknown): SaveItemsResult => {
    if (e instanceof ItemLockedError) return { ok: false, reason: "locked", itemId: e.itemId };
    throw e;
  });
}

/**
 * Quita un ítem del borrador y, antes, sus archivos (`blob_files` no cuelga por FK: la ref es opaca). Devuelve
 * `false` si el ítem no existe, no es de la persona o el informe ya se envió.
 */
export async function deleteItem(userId: string, itemId: string): Promise<boolean> {
  return withUser(userId, async (tx) => {
    const [item] = await tx
      .select({ id: s.feedbackItems.id })
      .from(s.feedbackItems)
      .where(and(eq(s.feedbackItems.id, itemId), eq(s.feedbackItems.userId, userId)))
      .limit(1);
    if (!item) return false;
    const refs = await tx
      .select({ ref: s.feedbackAttachments.blobRef })
      .from(s.feedbackAttachments)
      .where(eq(s.feedbackAttachments.itemId, itemId));
    const storage = pgBinaryStorage(tx);
    // Si el informe ya se envió la RLS no deja borrar el ítem: se prueba primero con el ítem
    const deleted = await tx
      .delete(s.feedbackItems)
      .where(and(eq(s.feedbackItems.id, itemId), eq(s.feedbackItems.userId, userId)))
      .returning({ id: s.feedbackItems.id });
    if (deleted.length !== 1) return false;
    for (const { ref } of refs) if (ref) await storage.delete(ref);
    return true;
  });
}

export type SendReportResult =
  | { ok: true; reportId: string; summary: string }
  | { ok: false; reason: "no_draft" | "empty" | "too_many" | "item_empty"; position?: number };

/** Envía el borrador: lo valida, lo marca `enviado` y devuelve el resumen para la confirmación y el aviso. */
export async function sendReport(userId: string): Promise<SendReportResult> {
  return withUser(userId, async (tx): Promise<SendReportResult> => {
    await lockReport(tx, userId);
    const draft = await draftIn(tx, userId);
    if (!draft) return { ok: false, reason: "no_draft" };
    const items = await tx
      .select({ id: s.feedbackItems.id, message: s.feedbackItems.message })
      .from(s.feedbackItems)
      .where(eq(s.feedbackItems.reportId, draft.id))
      .orderBy(asc(s.feedbackItems.position));
    const files = await attachmentsOf(
      tx,
      items.map((i) => i.id),
    );
    const checked = validateReportForSend(
      items.map((i) => ({ message: i.message, attachments: files.get(i.id)?.length ?? 0 })),
    );
    if (!checked.ok) {
      return "position" in checked
        ? { ok: false, reason: checked.reason, position: checked.position }
        : { ok: false, reason: checked.reason };
    }
    const now = new Date();
    await tx
      .update(s.feedbackReports)
      .set({ status: "enviado", sentAt: now, statusChangedAt: now, updatedAt: now })
      .where(eq(s.feedbackReports.id, draft.id));
    const counts = countReportAttachments(items.flatMap((i) => files.get(i.id) ?? []));
    return {
      ok: true,
      reportId: draft.id,
      summary: summarizeReport({ items: items.length, ...counts }),
    };
  });
}
