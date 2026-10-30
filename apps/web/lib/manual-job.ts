import { createLogger, safeDbError } from "@job-search-os/adapters";
import { MAX_JD_INPUT_CHARS, MAX_JOB_FIELD_CHARS, parseManualUrl } from "@job-search-os/pipeline";
import { revalidatePath } from "next/cache";
import { evaluateInBackgroundOrExplain } from "./evaluate-now";
import { ingestManualJob, parseModality } from "./ingest-manual";
import { invalidateUserInsights } from "./insights-cache";
import { invalidateMarketCandidates } from "./market";

export type ManualJobResult =
  | { ok: true; jobId: string; action: string; notEvaluated: string | null }
  | { ok: false; code: "campos" | "larga" | "url" | "ingesta" };

/**
 * Núcleo del alta manual (JS-023), común a /jobs/new y a la tarjeta del asistente (AG-5): valida
 * el formulario, ingesta (dedup, prefiltro, cola) e invalida los cachés. No redirige: cada llamador
 * decide qué hacer con el resultado. Con `evaluateNow` y JD completo se evalúa ya (JS-027); la
 * tarjeta del asistente no lo pide, así no depende del tiempo de la página donde está el panel: la
 * oferta queda en la cola y la evalúa el worker.
 */
export async function createManualJobFromForm(
  userId: string,
  formData: FormData,
  options: { evaluateNow: boolean },
): Promise<ManualJobResult> {
  const str = (k: string) => String(formData.get(k) ?? "").trim();
  const num = (k: string) => {
    const v = str(k);
    return v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null;
  };
  if (!str("title") || !str("company")) return { ok: false, code: "campos" };
  // S-2: tope de largo de la JD (el crudo también se guarda) y de los campos sueltos
  if (
    str("jdText").length > MAX_JD_INPUT_CHARS ||
    ["title", "company", "location"].some((k) => str(k).length > MAX_JOB_FIELD_CHARS)
  ) {
    return { ok: false, code: "larga" };
  }
  // Solo se valida el texto: el servidor nunca abre la URL (D-028)
  const parsedUrl = parseManualUrl(str("url"));
  if (!parsedUrl.ok) return { ok: false, code: "url" };
  let outcome;
  try {
    outcome = await ingestManualJob(userId, {
      url: parsedUrl.url,
      title: str("title"),
      company: str("company"),
      locationRaw: str("location") || null,
      modality: parseModality(str("modality")),
      jdText: str("jdText") || null,
      salaryMinUsd: num("salaryMin"),
      salaryMaxUsd: num("salaryMax"),
      candidatesCount: num("candidates"),
    });
  } catch (e) {
    createLogger({ user_id: userId }).error({ err: safeDbError(e) }, "alta manual falló");
    return { ok: false, code: "ingesta" };
  }
  // Los candidatos de /market salen de los JD recientes: se invalida el caché del usuario (JS-102).
  // Solo desde Server Actions; la ingesta del cron/email corre fuera de Next y espera al vencimiento (1 h).
  invalidateMarketCandidates(userId);
  // Una oferta nueva cambia «Tu encaje» (E-2b)
  invalidateUserInsights(userId);
  // Con el tope superado no se evalúa y la pantalla del detalle lo avisa (JS-105)
  const notEvaluated =
    options.evaluateNow && str("jdText")
      ? await evaluateInBackgroundOrExplain(userId, outcome.jobId)
      : null;
  revalidatePath("/jobs");
  revalidatePath("/jobs/pending-jd");
  return { ok: true, jobId: outcome.jobId, action: outcome.action, notEvaluated };
}
