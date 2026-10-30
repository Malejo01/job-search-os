"use server";

import { JOB_STATUSES, type JobStatus } from "@job-search-os/pipeline";
import { revalidatePath } from "next/cache";
import { changeJobStatus } from "@/lib/job-detail";
import { STATUS_LABELS } from "@/lib/labels";
import { createManualJobFromForm } from "@/lib/manual-job";
import { activeSessionUserId } from "@/lib/session";

/**
 * Server Actions de las tarjetas del asistente (AG-5). Comparten el núcleo con las de siempre
 * (`changeStatusAction` del detalle y `createManualJobAction` del alta) pero devuelven un resultado
 * en vez de redirigir: la tarjeta muestra el error en el lugar, sin perder la charla ni lo escrito.
 * El usuario sale de la sesión, nunca del formulario. Ninguna postula: «aplicada» solo marca.
 */

export type AssistantStatusResult =
  | { ok: true; status: JobStatus; toLabel: string }
  | {
      ok: false;
      code: "evento" | "transicion" | "cambio_estado" | "sesion";
      /** Cómo está la oferta ahora, si cambió desde que se armó la tarjeta. */
      currentLabel?: string;
    };

const isStatus = (v: string): v is JobStatus => (JOB_STATUSES as readonly string[]).includes(v);

export async function assistantChangeStatusAction(
  formData: FormData,
): Promise<AssistantStatusResult> {
  const userId = await activeSessionUserId();
  if (!userId) return { ok: false, code: "sesion" };
  const jobId = String(formData.get("jobId") ?? "");
  const event = String(formData.get("event") ?? "");
  const expected = String(formData.get("expectedStatus") ?? "");
  // Sin estado esperado no hay compare-and-set: la tarjeta siempre lo manda
  if (!isStatus(expected)) return { ok: false, code: "evento" };
  const result = await changeJobStatus(userId, jobId, event, expected);
  if (!result.ok) {
    if (result.code === "cambio_estado" || result.code === "inexistente") {
      return {
        ok: false,
        code: "cambio_estado",
        ...(result.current
          ? { currentLabel: STATUS_LABELS[result.current] ?? result.current }
          : {}),
      };
    }
    return { ok: false, code: result.code };
  }
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/jobs");
  return {
    ok: true,
    status: result.status,
    toLabel: STATUS_LABELS[result.status] ?? result.status,
  };
}

export type AssistantCreateJobResult =
  | { ok: true; jobId: string; action: string }
  | { ok: false; code: "campos" | "url" | "larga" | "ingesta" | "sesion" };

export async function assistantCreateJobAction(
  formData: FormData,
): Promise<AssistantCreateJobResult> {
  const userId = await activeSessionUserId();
  if (!userId) return { ok: false, code: "sesion" };
  // Sin evaluación inmediata: la oferta queda en la cola y la evalúa el worker en un rato
  const result = await createManualJobFromForm(userId, formData, { evaluateNow: false });
  return result.ok ? { ok: true, jobId: result.jobId, action: result.action } : result;
}
