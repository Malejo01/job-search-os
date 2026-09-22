"use server";

import { JOB_EVENTS, JOB_STATUSES, type JobEvent, type JobStatus } from "@job-search-os/pipeline";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createLogger } from "@job-search-os/adapters";
import { dismissDuplicate, mergeDuplicate } from "@/lib/duplicates";
import { evaluateInBackground } from "@/lib/evaluate-now";
import { applyJobEvent, correctJobStatus, MANUAL_EVENTS, saveHumanScore } from "@/lib/job-detail";
import { requireUserId } from "@/lib/session";

/** Server Actions del detalle (JS-016). Validan la entrada y delegan en lib/job-detail (transition()). */
export async function changeStatusAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const jobId = String(formData.get("jobId") ?? "");
  const event = String(formData.get("event") ?? "") as JobEvent;
  if (
    !jobId ||
    !(JOB_EVENTS as readonly string[]).includes(event) ||
    !MANUAL_EVENTS.includes(event)
  ) {
    redirect(`/jobs/${jobId}?error=evento`);
  }
  try {
    await applyJobEvent(userId, jobId, event);
  } catch (e) {
    if (e instanceof Error && e.name === "InvalidTransitionError") {
      redirect(`/jobs/${jobId}?error=transicion`);
    }
    throw e;
  }
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/jobs");
}

export async function humanScoreAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const jobId = String(formData.get("jobId") ?? "");
  const evaluationId = String(formData.get("evaluationId") ?? "");
  const rawScore = String(formData.get("humanScore") ?? "").trim();
  const note = String(formData.get("humanNote") ?? "").trim();
  const score = rawScore === "" ? null : Number(rawScore.replace(",", "."));
  if (score !== null && !Number.isFinite(score)) redirect(`/jobs/${jobId}?error=score`);
  try {
    await saveHumanScore(userId, evaluationId, score, note || null);
  } catch (e) {
    if (e instanceof Error && /score humano/.test(e.message))
      redirect(`/jobs/${jobId}?error=score`);
    throw e;
  }
  revalidatePath(`/jobs/${jobId}`);
}

/** Corrección manual de un estado mal marcado (JS-028). La confirmación la pide el cliente. */
export async function correctStatusAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const jobId = String(formData.get("jobId") ?? "");
  const to = String(formData.get("to") ?? "") as JobStatus;
  if (!jobId || !(JOB_STATUSES as readonly string[]).includes(to)) {
    redirect(`/jobs/${jobId}?error=correccion`);
  }
  try {
    const { from } = await correctJobStatus(userId, jobId, to);
    createLogger({ user_id: userId, job_id: jobId }).info({ from, to }, "estado corregido a mano");
  } catch (e) {
    if (e instanceof Error && e.name === "InvalidCorrectionError") {
      redirect(`/jobs/${jobId}?error=correccion`);
    }
    throw e;
  }
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/jobs");
  revalidatePath("/applications");
}

/** Fusión manual de un posible duplicado (JS-025). La confirmación la pide el cliente. */
export async function mergeDuplicateAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const jobId = String(formData.get("jobId") ?? "");
  let survivorId: string;
  try {
    const out = await mergeDuplicate(userId, jobId);
    survivorId = out.survivorId;
    createLogger({ user_id: userId, job_id: out.survivorId }).info(
      { absorbed_id: out.absorbedId, enqueued: out.enqueued },
      "posible duplicado fusionado a mano",
    );
    // El que queda recibió la JD que le faltaba: se evalúa ya, como al pegarla (JS-027)
    if (out.enqueued) evaluateInBackground(userId, out.survivorId);
  } catch (e) {
    if (e instanceof Error && e.name === "DuplicateMergeFailure") {
      redirect(`/jobs/${jobId}?error=fusion`);
    }
    throw e;
  }
  revalidatePath("/jobs");
  redirect(`/jobs/${survivorId}`);
}

/** "No son la misma" (JS-025): saca la marca de posible duplicado. */
export async function dismissDuplicateAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const jobId = String(formData.get("jobId") ?? "");
  await dismissDuplicate(userId, jobId);
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/jobs");
}
