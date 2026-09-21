"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { evaluateInBackground } from "@/lib/evaluate-now";
import { applyJobEvent } from "@/lib/job-detail";
import { attachJd } from "@/lib/pending-jd";
import { requireUserId } from "@/lib/session";

const PAGE = "/jobs/pending-jd";

/** Pegar JD → guarda jd_text, encola y evalúa al instante en segundo plano (JS-017, JS-027). */
export async function pasteJdAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const jobId = String(formData.get("jobId") ?? "");
  const text = String(formData.get("jdText") ?? "");
  if (!jobId) redirect(`${PAGE}?error=oferta`);
  try {
    await attachJd(userId, jobId, text);
  } catch (e) {
    if (e instanceof Error && e.name === "JdTooShortError") redirect(`${PAGE}?error=corta`);
    throw e;
  }
  evaluateInBackground(userId, jobId);
  revalidatePath(PAGE);
  revalidatePath("/jobs");
  redirect(`${PAGE}?ok=${jobId}`);
}

/** Botón "cerrada": transition(status, "close"). */
export async function closeJobAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const jobId = String(formData.get("jobId") ?? "");
  if (!jobId) redirect(`${PAGE}?error=oferta`);
  await applyJobEvent(userId, jobId, "close");
  revalidatePath(PAGE);
  revalidatePath("/jobs");
}
