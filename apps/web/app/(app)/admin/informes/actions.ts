"use server";

import { isFeedbackStatus } from "@job-search-os/pipeline";
import { revalidatePath } from "next/cache";
import { requireAdminOr404 } from "@/lib/admin-guard";
import {
  purgeItemAttachments,
  purgeResolvedNow,
  setReportItemStatus,
} from "@/lib/admin-feedback-reports";
import { requireActiveUserId } from "@/lib/session";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Cambia el estado de un ítem de un informe de revisión (R29-05). Sesión, admin y valores se validan acá y en la
 * base (`admin_feedback_item_set_status` deriva además el estado del informe y rechaza los borradores).
 */
export async function setReportItemStatusAction(formData: FormData): Promise<void> {
  const userId = await requireActiveUserId();
  await requireAdminOr404(userId);
  const itemId = String(formData.get("itemId") ?? "");
  const reportId = String(formData.get("reportId") ?? "");
  const status = formData.get("status");
  if (!UUID.test(itemId) || !UUID.test(reportId) || !isFeedbackStatus(status)) return;
  await setReportItemStatus(userId, itemId, status);
  revalidatePath("/admin/informes");
  revalidatePath(`/admin/informes/${reportId}`);
}

/**
 * Borra ahora los adjuntos de lo resuelto hace 30 días o más (R29-09). No se puede deshacer: la pantalla muestra
 * antes cuántos archivos y MB son. Admin validado acá y en la base (`purge_resolved_attachments`).
 */
export async function purgeResolvedAttachmentsAction(): Promise<void> {
  const userId = await requireActiveUserId();
  await requireAdminOr404(userId);
  await purgeResolvedNow(userId);
  revalidatePath("/admin/informes");
}

/** Borra los adjuntos de un ítem ya resuelto (R29-09). Si el ítem no está resuelto, la base no borra nada. */
export async function purgeItemAttachmentsAction(formData: FormData): Promise<void> {
  const userId = await requireActiveUserId();
  await requireAdminOr404(userId);
  const itemId = String(formData.get("itemId") ?? "");
  const reportId = String(formData.get("reportId") ?? "");
  if (!UUID.test(itemId) || !UUID.test(reportId)) return;
  await purgeItemAttachments(userId, itemId);
  revalidatePath(`/admin/informes/${reportId}`);
}
