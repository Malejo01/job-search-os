"use server";

import { JOB_EVENTS, type JobEvent } from "@job-search-os/pipeline";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { applyJobEvent, MANUAL_EVENTS, saveHumanScore } from "@/lib/job-detail";
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
