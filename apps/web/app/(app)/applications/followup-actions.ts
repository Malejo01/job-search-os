"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { snoozeFollowUp } from "@/lib/applications";
import { applyJobEvent } from "@/lib/job-detail";
import { requireActiveUserId } from "@/lib/session";

const JobId = z.string().uuid();

function revalidate(): void {
  revalidatePath("/applications");
  revalidatePath("/jobs");
}

/** «Ya hice seguimiento»: posterga 7 días el aviso de la postulación. */
export async function snoozeFollowUpAction(jobId: string): Promise<void> {
  const userId = await requireActiveUserId();
  await snoozeFollowUp(userId, JobId.parse(jobId), 7);
  revalidate();
}

/** «Cerrar»: la oferta pasa a cerrada con el evento `close` y sale del seguimiento. */
export async function closeApplicationAction(jobId: string): Promise<void> {
  const userId = await requireActiveUserId();
  await applyJobEvent(userId, JobId.parse(jobId), "close");
  revalidate();
}
