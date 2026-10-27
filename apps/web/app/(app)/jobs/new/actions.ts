"use server";

import { redirect } from "next/navigation";
import { createManualJobFromForm } from "@/lib/manual-job";
import { requireActiveUserId } from "@/lib/session";

/** Alta manual de una oferta (JS-023): URL + texto pegado → dedup, prefiltro, cola. */
export async function createManualJobAction(formData: FormData): Promise<void> {
  // requireActiveUserId: el gate del layout no cubre llamadas directas a la acción (S-5)
  const userId = await requireActiveUserId();
  // Mismo núcleo que la tarjeta del asistente (AG-5); acá con evaluación inmediata y redirección
  const result = await createManualJobFromForm(userId, formData, { evaluateNow: true });
  if (!result.ok) redirect(`/jobs/new?error=${result.code}`);
  redirect(
    `/jobs/${result.jobId}?nueva=${result.action}${result.notEvaluated ? `&cap=${result.notEvaluated}` : ""}`,
  );
}
