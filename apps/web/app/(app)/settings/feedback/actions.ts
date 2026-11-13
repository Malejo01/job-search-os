"use server";

import { isFeedbackStatus } from "@job-search-os/pipeline";
import { revalidatePath } from "next/cache";
import { requireAdminOr404 } from "@/lib/admin-guard";
import { setFeedbackStatus } from "@/lib/feedback-triage";
import { requireActiveUserId } from "@/lib/session";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Cambia el estado de un comentario (C8-17). Sesión, admin y valores se validan acá y en la base. */
export async function setFeedbackStatusAction(formData: FormData): Promise<void> {
  const userId = await requireActiveUserId();
  await requireAdminOr404(userId);
  const id = String(formData.get("id") ?? "");
  const status = formData.get("status");
  if (!UUID.test(id) || !isFeedbackStatus(status)) return;
  await setFeedbackStatus(userId, id, status);
  revalidatePath("/settings/feedback");
}
