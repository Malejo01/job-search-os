/**
 * «Mi informe de revisión» (R29-02): reglas puras del informe largo de las personas que revisan la beta
 * (testers y admins). Sin I/O: las usan la server action, la pantalla `/recorrido/informe` y los tests. Los
 * límites de forma se repiten como CHECK en la base (`feedback_items_*`, migración 0084); `packages/db` tiene un
 * test que los compara. Los topes de adjuntos viven en `attachment.ts`.
 */
import {
  isFeedbackCategory,
  isValidFeedbackPath,
  normalizeFeedbackMessage,
  normalizeFeedbackPath,
  type FeedbackCategory,
} from "./beta-feedback";
import { normalizeScreenPath } from "./screen-path";

/** Ítems por informe. */
export const REPORT_ITEMS_MAX = 30;
/** Caracteres por ítem (la base lo repite como CHECK). */
export const ITEM_MESSAGE_MAX = 50_000;

/** Estado del informe: lo que la persona arma (borrador), lo que mandó y lo que el admin va leyendo. */
export const REPORT_STATUSES = ["borrador", "enviado", "visto", "resuelto"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];
export const REPORT_STATUS_LABELS: Record<ReportStatus, string> = {
  borrador: "Borrador",
  enviado: "Enviado",
  visto: "Visto",
  resuelto: "Resuelto",
};

/** Estado de cada ítem para el admin (mismos nombres que el triage de los comentarios sueltos). */
export const ITEM_STATUSES = ["nuevo", "visto", "resuelto"] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];
export const ITEM_STATUS_LABELS: Record<ItemStatus, string> = {
  nuevo: "Nuevo",
  visto: "Visto",
  resuelto: "Resuelto",
};

export function isReportStatus(value: unknown): value is ReportStatus {
  return typeof value === "string" && (REPORT_STATUSES as readonly string[]).includes(value);
}

export function isItemStatus(value: unknown): value is ItemStatus {
  return typeof value === "string" && (ITEM_STATUSES as readonly string[]).includes(value);
}

/** Solo el borrador se edita (ítems, texto, adjuntos). Un informe enviado queda como se mandó. */
export function canEditReport(status: ReportStatus): boolean {
  return status === "borrador";
}

/** Solo el borrador se envía (un informe no se manda dos veces). */
export function canSendReport(status: ReportStatus): boolean {
  return status === "borrador";
}

export type ReportItemInput = {
  /** Pantalla del árbol de `app/` (`/jobs/[id]`), sin ids, query ni fragmento. */
  path: string;
  category: FeedbackCategory;
  /** Puede estar vacío en un borrador (un ítem con solo capturas); para enviar hace falta texto o adjuntos. */
  message: string;
};

export type ReportItemField = "path" | "category" | "message";

export type ReportItemValidation =
  { ok: true; value: ReportItemInput } | { ok: false; field: ReportItemField };

/**
 * Valida y normaliza un ítem (puro). Devuelve el primer campo inválido, nunca su contenido. Reusa las reglas del
 * comentario suelto: texto sin caracteres invisibles ni bidireccionales, pantalla sin ids ni query.
 */
export function validateReportItem(raw: {
  path: unknown;
  category: unknown;
  message: unknown;
}): ReportItemValidation {
  if (!isFeedbackCategory(raw.category)) return { ok: false, field: "category" };
  if (!isValidFeedbackPath(raw.path)) return { ok: false, field: "path" };
  if (typeof raw.message !== "string") return { ok: false, field: "message" };
  const message = normalizeFeedbackMessage(raw.message);
  if (message.length > ITEM_MESSAGE_MAX) return { ok: false, field: "message" };
  return {
    ok: true,
    value: {
      path: normalizeScreenPath(normalizeFeedbackPath(raw.path)),
      category: raw.category,
      message,
    },
  };
}

/** Un ítem se puede mandar si tiene texto o al menos un adjunto. */
export function isItemReadyToSend(item: { message: string; attachments: number }): boolean {
  return item.message.trim().length > 0 || item.attachments > 0;
}

export type ReportSendValidation =
  | { ok: true }
  | { ok: false; reason: "empty" }
  | { ok: false; reason: "too_many" }
  | { ok: false; reason: "item_empty"; position: number };

/** Antes de enviar: al menos un ítem, no más de 30 y ninguno vacío (`position` cuenta desde 1). */
export function validateReportForSend(
  items: readonly { message: string; attachments: number }[],
): ReportSendValidation {
  if (items.length === 0) return { ok: false, reason: "empty" };
  if (items.length > REPORT_ITEMS_MAX) return { ok: false, reason: "too_many" };
  const at = items.findIndex((i) => !isItemReadyToSend(i));
  if (at >= 0) return { ok: false, reason: "item_empty", position: at + 1 };
  return { ok: true };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** «12 ítems, 18 capturas, 2 documentos»: el resumen de la confirmación y del email a los admins. */
export function summarizeReport(counts: {
  items: number;
  screenshots: number;
  documents: number;
}): string {
  return [
    plural(counts.items, "ítem", "ítems"),
    plural(counts.screenshots, "captura", "capturas"),
    plural(counts.documents, "documento", "documentos"),
  ].join(", ");
}

/** Las imágenes son capturas; PDF y DOCX son documentos. Los adjuntos borrados no cuentan. */
export function countReportAttachments(
  attachments: readonly { kind: string; deleted?: boolean }[],
): { screenshots: number; documents: number } {
  let screenshots = 0;
  let documents = 0;
  for (const a of attachments) {
    if (a.deleted) continue;
    if (a.kind === "image") screenshots++;
    else if (a.kind === "pdf" || a.kind === "docx") documents++;
  }
  return { screenshots, documents };
}
