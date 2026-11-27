"use server";

import { revalidatePath } from "next/cache";
import { retryJobCardFor } from "@/lib/job-card";
import { activeSessionUserId } from "@/lib/session";

/**
 * «Reintentar» de la ficha del aviso (R31-03). Form action: recibe `jobId` en el formulario. Sin sesión vigente no
 * hace nada; con ella programa el reintento (la ficha fallida vuelve a pedirse, con su máximo de intentos y los
 * topes de la reserva) y refresca la página. Nunca devuelve el motivo: la pantalla ya muestra el estado.
 */
export async function retryJobCardAction(formData: FormData): Promise<void> {
  const jobId = String(formData.get("jobId") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) return;
  const userId = await activeSessionUserId();
  if (!userId) return;
  await retryJobCardFor(userId, jobId);
  revalidatePath(`/jobs/${jobId}`);
}
