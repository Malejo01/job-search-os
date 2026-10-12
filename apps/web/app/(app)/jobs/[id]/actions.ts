"use server";

import { JOB_EVENTS, JOB_STATUSES, type JobEvent, type JobStatus } from "@job-search-os/pipeline";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createLogger, createPgQueue, enqueueEvaluationWith } from "@job-search-os/adapters";
import { schema as s } from "@job-search-os/db";
import { eq, sql } from "drizzle-orm";
import { withUser } from "@/lib/db";
import { dismissDuplicate, mergeDuplicate } from "@/lib/duplicates";
import { evaluateInBackgroundOrExplain } from "@/lib/evaluate-now";
import { isUuid } from "@/lib/ids";
import { applyJobEvent, correctJobStatus, MANUAL_EVENTS, saveHumanScore } from "@/lib/job-detail";
import { evaluatingSql } from "@/lib/jobs";
import { requireUserId } from "@/lib/session";

/** Server Actions del detalle (JS-016). Validan la entrada y delegan en lib/job-detail (transition()). */
export async function changeStatusAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const jobId = String(formData.get("jobId") ?? "");
  const event = String(formData.get("event") ?? "") as JobEvent;
  if (
    !jobId ||
    !(JOB_EVENTS as readonly string[]).includes(event) ||
    !MANUAL_EVENTS.includes(event)
  ) {
    redirect(`/jobs/${jobId}?error=evento`);
  }
  try {
    await applyJobEvent(userId, jobId, event);
  } catch (e) {
    if (e instanceof Error && e.name === "InvalidTransitionError") {
      redirect(`/jobs/${jobId}?error=transicion`);
    }
    throw e;
  }
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/jobs");
}

export async function humanScoreAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const jobId = String(formData.get("jobId") ?? "");
  const evaluationId = String(formData.get("evaluationId") ?? "");
  const rawScore = String(formData.get("humanScore") ?? "").trim();
  const note = String(formData.get("humanNote") ?? "").trim();
  const score = rawScore === "" ? null : Number(rawScore.replace(",", "."));
  if (score !== null && !Number.isFinite(score)) redirect(`/jobs/${jobId}?error=score`);
  try {
    await saveHumanScore(userId, evaluationId, score, note || null);
  } catch (e) {
    if (e instanceof Error && /score humano/.test(e.message))
      redirect(`/jobs/${jobId}?error=score`);
    throw e;
  }
  revalidatePath(`/jobs/${jobId}`);
}

/** Corrección manual de un estado mal marcado (JS-028). La confirmación la pide el cliente. */
export async function correctStatusAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const jobId = String(formData.get("jobId") ?? "");
  const to = String(formData.get("to") ?? "") as JobStatus;
  if (!jobId || !(JOB_STATUSES as readonly string[]).includes(to)) {
    redirect(`/jobs/${jobId}?error=correccion`);
  }
  try {
    const { from } = await correctJobStatus(userId, jobId, to);
    createLogger({ user_id: userId, job_id: jobId }).info({ from, to }, "estado corregido a mano");
  } catch (e) {
    if (e instanceof Error && e.name === "InvalidCorrectionError") {
      redirect(`/jobs/${jobId}?error=correccion`);
    }
    throw e;
  }
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/jobs");
  revalidatePath("/applications");
}

/** Fusión manual de un posible duplicado (JS-025). La confirmación la pide el cliente. */
export async function mergeDuplicateAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const jobId = String(formData.get("jobId") ?? "");
  let survivorId: string;
  let notEvaluated: string | null = null;
  try {
    const out = await mergeDuplicate(userId, jobId);
    survivorId = out.survivorId;
    createLogger({ user_id: userId, job_id: out.survivorId }).info(
      { absorbed_id: out.absorbedId, enqueued: out.enqueued },
      "posible duplicado fusionado a mano",
    );
    // El que queda recibió la JD que le faltaba: se evalúa ya, como al pegarla (JS-027)
    // Con el tope superado queda en la cola y el detalle lo avisa (JS-105)
    if (out.enqueued) notEvaluated = await evaluateInBackgroundOrExplain(userId, out.survivorId);
  } catch (e) {
    if (e instanceof Error && e.name === "DuplicateMergeFailure") {
      redirect(`/jobs/${jobId}?error=fusion`);
    }
    throw e;
  }
  revalidatePath("/jobs");
  redirect(`/jobs/${survivorId}${notEvaluated ? `?cap=${notEvaluated}` : ""}`);
}

/**
 * "Evaluar ahora": encola la evaluación de una oferta que tiene JD, no tiene evaluación y no está
 * en cola, y la programa. Verifica todo con RLS (la oferta tiene que ser del usuario). El doble
 * envío no duplica: la cola es idempotente y el botón se deshabilita mientras corre.
 */
export async function evaluateNowAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const jobId = String(formData.get("jobId") ?? "");
  if (!isUuid(jobId)) redirect("/jobs");
  const outcome = await withUser(userId, async (tx) => {
    const [job] = await tx
      .select({
        jdText: s.jobs.jdText,
        evaluated: sql<boolean>`exists (select 1 from evaluations e where e.job_id = "jobs"."id")`,
        evaluating: evaluatingSql(),
      })
      .from(s.jobs)
      .where(eq(s.jobs.id, jobId))
      .limit(1);
    if (!job || !job.jdText?.trim()) return "invalida" as const;
    if (job.evaluated || job.evaluating) return "ya" as const;
    await enqueueEvaluationWith(tx, createPgQueue(tx))(jobId, userId);
    return "encolada" as const;
  });
  if (outcome === "invalida") redirect(`/jobs/${jobId}?error=evaluar`);
  const notEvaluated =
    outcome === "encolada" ? await evaluateInBackgroundOrExplain(userId, jobId) : null;
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/jobs");
  redirect(`/jobs/${jobId}${notEvaluated ? `?cap=${notEvaluated}` : ""}`);
}

/** "No son la misma" (JS-025): saca la marca de posible duplicado. */
export async function dismissDuplicateAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const jobId = String(formData.get("jobId") ?? "");
  await dismissDuplicate(userId, jobId);
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/jobs");
}
