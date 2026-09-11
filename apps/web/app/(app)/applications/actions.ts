"use server";

import { APPLICATION_OUTCOMES, type ApplicationOutcome } from "@job-search-os/pipeline";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { setApplicationOutcome } from "@/lib/applications";
import { requireUserId } from "@/lib/session";

/** Cambia el resultado de una postulación (JS-036). */
export async function setOutcomeAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const applicationId = String(formData.get("applicationId") ?? "");
  const outcome = String(formData.get("outcome") ?? "") as ApplicationOutcome;
  const note = String(formData.get("note") ?? "").trim();
  if (!applicationId || !(APPLICATION_OUTCOMES as readonly string[]).includes(outcome)) {
    redirect("/applications?error=1");
  }
  await setApplicationOutcome(userId, applicationId, outcome, note || null);
  revalidatePath("/applications");
  revalidatePath("/jobs");
}
