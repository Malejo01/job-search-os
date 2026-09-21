"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { evaluateInBackground } from "@/lib/evaluate-now";
import { ingestManualJob, parseModality } from "@/lib/ingest-manual";
import { requireUserId } from "@/lib/session";

/** Alta manual de una oferta (JS-023): URL + texto pegado → dedup, prefiltro, cola. */
export async function createManualJobAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const str = (k: string) => String(formData.get(k) ?? "").trim();
  const num = (k: string) => {
    const v = str(k);
    return v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null;
  };
  if (!str("title") || !str("company")) redirect("/jobs/new?error=campos");
  let outcome;
  try {
    outcome = await ingestManualJob(userId, {
      url: str("url") || null,
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
    const msg = e instanceof Error ? e.message : String(e);
    redirect(`/jobs/new?error=${encodeURIComponent(msg.slice(0, 120))}`);
  }
  // Con JD completo se evalúa ya (JS-027); si no quedó nada encolado, no hace nada
  if (str("jdText")) evaluateInBackground(userId, outcome.jobId);
  revalidatePath("/jobs");
  revalidatePath("/jobs/pending-jd");
  redirect(`/jobs/${outcome.jobId}?nueva=${outcome.action}`);
}
