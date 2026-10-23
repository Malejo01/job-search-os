"use server";

import { createLogger, safeDbError } from "@job-search-os/adapters";
import { MAX_JD_INPUT_CHARS, MAX_JOB_FIELD_CHARS, parseManualUrl } from "@job-search-os/pipeline";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { evaluateInBackgroundOrExplain } from "@/lib/evaluate-now";
import { ingestManualJob, parseModality } from "@/lib/ingest-manual";
import { invalidateMarketCandidates } from "@/lib/market";
import { requireActiveUserId } from "@/lib/session";

/** Alta manual de una oferta (JS-023): URL + texto pegado → dedup, prefiltro, cola. */
export async function createManualJobAction(formData: FormData): Promise<void> {
  // requireActiveUserId: el gate del layout no cubre llamadas directas a la acción (S-5)
  const userId = await requireActiveUserId();
  const str = (k: string) => String(formData.get(k) ?? "").trim();
  const num = (k: string) => {
    const v = str(k);
    return v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null;
  };
  if (!str("title") || !str("company")) redirect("/jobs/new?error=campos");
  // S-2: tope de largo de la JD (el crudo también se guarda) y de los campos sueltos
  if (
    str("jdText").length > MAX_JD_INPUT_CHARS ||
    ["title", "company", "location"].some((k) => str(k).length > MAX_JOB_FIELD_CHARS)
  )
    redirect("/jobs/new?error=larga");
  // Solo se valida el texto: el servidor nunca abre la URL (D-028)
  const parsedUrl = parseManualUrl(str("url"));
  if (!parsedUrl.ok) redirect("/jobs/new?error=url");
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
    redirect("/jobs/new?error=ingesta");
  }
  // Los candidatos de /market salen de los JD recientes: se invalida el caché del usuario (JS-102).
  // Solo desde Server Actions; la ingesta del cron/email corre fuera de Next y espera al vencimiento (1 h).
  invalidateMarketCandidates(userId);
  // Con JD completo se evalúa ya (JS-027); si no quedó nada encolado, no hace nada
  // Con el tope superado no se evalúa y la pantalla del detalle lo avisa (JS-105)
  const notEvaluated = str("jdText")
    ? await evaluateInBackgroundOrExplain(userId, outcome.jobId)
    : null;
  revalidatePath("/jobs");
  revalidatePath("/jobs/pending-jd");
  redirect(
    `/jobs/${outcome.jobId}?nueva=${outcome.action}${notEvaluated ? `&cap=${notEvaluated}` : ""}`,
  );
}
