"use server";

import type { ExtractImageFailure } from "@job-search-os/adapters";
import { MAX_IMAGE_BYTES, MAX_IMAGE_OFFERS, type ImageOffer } from "@job-search-os/pipeline";
import { redirect } from "next/navigation";
import { createManualJobFromForm } from "@/lib/manual-job";
import { activeSessionUserId, requireActiveUserId } from "@/lib/session";
import { extractJobImageForUser } from "./image-server";

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

/** Resultado de leer la imagen: lo que vuelve al cliente es una propuesta, nunca algo ya guardado. */
export type ImageReadState =
  | { status: "ok"; offers: ImageOffer[] }
  | { status: "error"; code: ExtractImageFailure | "sesion" };

/**
 * «Leer la imagen» (R6-3). Recibe el JPEG que el navegador ya redujo, lo manda al modelo (tarea
 * `extract_job_from_image`) y devuelve los campos para revisar. No crea nada, no guarda la imagen ni
 * el texto leído. Los topes (10 por día y el gasto) los aplica `extractJobFromImage`.
 */
export async function readJobImageAction(formData: FormData): Promise<ImageReadState> {
  // Sin redirigir: la pantalla muestra el motivo sin perder lo que la persona tenía escrito
  const userId = await activeSessionUserId();
  if (!userId) return { status: "error", code: "sesion" };
  const file = formData.get("image");
  if (!(file instanceof File) || file.size === 0) return { status: "error", code: "imagen_vacia" };
  // Antes de leerla a memoria: lo que no entra en el tope no se baja
  if (file.size > MAX_IMAGE_BYTES) return { status: "error", code: "imagen_grande" };
  const outcome = await extractJobImageForUser(userId, new Uint8Array(await file.arrayBuffer()));
  return outcome.ok
    ? { status: "ok", offers: outcome.offers }
    : { status: "error", code: outcome.code };
}

/**
 * «Cargar las ofertas elegidas» (R6-3): por cada oferta tildada, el mismo camino de la carga a mano
 * (`createManualJobFromForm`: dedup, prefiltro, cola y evaluación inmediata). Los campos llegan
 * con el prefijo `o<i>.`; lo que la persona editó en la revisión es lo que se guarda, no lo que
 * leyó el modelo. Una oferta sin título o sin empresa no se crea.
 */
export async function createJobsFromImageAction(formData: FormData): Promise<void> {
  const userId = await requireActiveUserId();
  let created = 0;
  let failed = 0;
  let lastJobId: string | null = null;
  let lastAction = "";
  let lastNotEvaluated: string | null = null;
  for (let i = 0; i < MAX_IMAGE_OFFERS; i++) {
    if (formData.get(`o${i}.include`) !== "on") continue;
    const prefix = `o${i}.`;
    const one = new FormData();
    for (const [key, value] of formData.entries()) {
      if (key.startsWith(prefix) && typeof value === "string") {
        one.set(key.slice(prefix.length), value);
      }
    }
    // Solo la primera se evalúa ya; las demás quedan en la cola para el worker (no se disparan hasta
    // 5 evaluaciones juntas desde una sola imagen)
    const result = await createManualJobFromForm(userId, one, {
      evaluateNow: created + failed === 0,
    });
    if (result.ok) {
      created++;
      lastJobId = result.jobId;
      lastAction = result.action;
      lastNotEvaluated = result.notEvaluated;
    } else {
      failed++;
    }
  }
  if (created + failed === 0) redirect("/jobs/new?modo=pegar&error=imagen_sin_seleccion");
  if (failed > 0) redirect(`/jobs/new?modo=pegar&error=imagen_parcial&n=${created}`);
  // Una sola: directo a su detalle, como la carga a mano. Varias: a la lista.
  if (created === 1 && lastJobId) {
    redirect(
      `/jobs/${lastJobId}?nueva=${lastAction}${lastNotEvaluated ? `&cap=${lastNotEvaluated}` : ""}`,
    );
  }
  redirect("/jobs");
}
