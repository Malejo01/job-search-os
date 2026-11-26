"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createLogger } from "@job-search-os/adapters";
import { isUuid } from "@/lib/ids";
import { setJobSaved } from "@/lib/job-saved";
import { requireActiveUserId } from "@/lib/session";

/**
 * «Guardar» y «Quitar de guardadas» (R30-03). Una marca con fecha, no un estado: no pasa por
 * `transition()`. Sin redirect si sale bien: desde la lista o el detalle la persona se queda donde está.
 */
async function run(formData: FormData, saved: boolean): Promise<void> {
  const userId = await requireActiveUserId();
  const jobId = String(formData.get("jobId") ?? "");
  // Sin un uuid válido no se arma una ruta ni se toca la base con lo que mandó el cliente
  if (!isUuid(jobId)) redirect("/jobs");
  const result = await setJobSaved(userId, jobId, saved);
  if (!result.ok) redirect("/jobs");
  createLogger({ user_id: userId, job_id: jobId }).info(
    { saved },
    "oferta guardada o quitada de guardadas",
  );
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/jobs");
}

export async function saveJobAction(formData: FormData): Promise<void> {
  await run(formData, true);
}

export async function unsaveJobAction(formData: FormData): Promise<void> {
  await run(formData, false);
}
