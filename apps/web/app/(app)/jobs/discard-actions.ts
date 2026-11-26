"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createLogger } from "@job-search-os/adapters";
import { isUuid } from "@/lib/ids";
import { changeJobStatus, correctJobStatus } from "@/lib/job-detail";
import { listQuery, parseJobFilters } from "@/lib/jobs";
import { requireActiveUserId } from "@/lib/session";

/**
 * Descartar y «Volver a revisar» desde el listado (R30-06). Descartar es el evento `discard` de siempre
 * (transition()); volver a revisar es la corrección manual descartada → evaluada de JS-028, que ya
 * existe y no pasa por la máquina de eventos. `back` es el query string de la lista: se vuelve a armar
 * solo con los filtros que la lista conoce, nunca se redirige a lo que mande el cliente.
 */
function backQuery(raw: FormDataEntryValue | null): string {
  const text = typeof raw === "string" ? raw.slice(0, 300) : "";
  const params = Object.fromEntries(new URLSearchParams(text.replace(/^\?/, "")));
  return listQuery(parseJobFilters(params));
}

function withParam(query: string, key: string, value: string): string {
  return `/jobs${query}${query ? "&" : "?"}${key}=${value}`;
}

/** «Descartar»: el aviso «Oferta descartada. [Deshacer]» lo muestra la lista con `?descartada=<id>`. */
export async function discardJobAction(formData: FormData): Promise<void> {
  const userId = await requireActiveUserId();
  const jobId = String(formData.get("jobId") ?? "");
  const back = backQuery(formData.get("back"));
  if (!isUuid(jobId)) redirect(`/jobs${back}`);
  const result = await changeJobStatus(userId, jobId, "discard");
  if (!result.ok) redirect(`/jobs${back}`);
  createLogger({ user_id: userId, job_id: jobId }).info({}, "oferta descartada desde el listado");
  revalidatePath("/jobs");
  redirect(withParam(back, "descartada", jobId));
}

/** «Volver a revisar» y «Deshacer»: la oferta vuelve a «Por revisar» (evaluada). */
export async function reviewAgainAction(formData: FormData): Promise<void> {
  const userId = await requireActiveUserId();
  const jobId = String(formData.get("jobId") ?? "");
  const back = backQuery(formData.get("back"));
  if (!isUuid(jobId)) redirect(`/jobs${back}`);
  try {
    await correctJobStatus(userId, jobId, "evaluada");
    createLogger({ user_id: userId, job_id: jobId }).info({}, "oferta descartada vuelta a revisar");
  } catch (e) {
    // Una oferta sin evaluación o que ya no está descartada no se puede volver a revisar: la lista sigue igual
    if (!(e instanceof Error && e.name === "InvalidCorrectionError")) throw e;
  }
  revalidatePath("/jobs");
  revalidatePath(`/jobs/${jobId}`);
  redirect(`/jobs${back}`);
}
