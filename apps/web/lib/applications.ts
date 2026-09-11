import { schema as s } from "@job-search-os/db";
import {
  APPLICATION_OUTCOMES,
  buildFeedbackReport,
  type ApplicationOutcome,
  type FeedbackReport,
  type FeedbackRow,
} from "@job-search-os/pipeline";
import { and, desc, eq } from "drizzle-orm";
import { withUser, type Tx } from "./db";

/** Postulaciones y feedback loop (JS-036): lectura y cambio de resultado con el rol de la app (RLS). */
export type ApplicationView = {
  id: string;
  jobId: string;
  title: string;
  company: string;
  status: string;
  appliedAt: string | null;
  channel: string | null;
  outcome: ApplicationOutcome;
  outcomeAt: string | null;
  outcomeNote: string | null;
  score: number | null;
  accion: string | null;
  model: string | null;
};

const asOutcome = (v: string | null): ApplicationOutcome =>
  (APPLICATION_OUTCOMES as readonly string[]).includes(v ?? "")
    ? (v as ApplicationOutcome)
    : "sin_respuesta";

/** Última evaluación por job (la que manda en la UI). */
function latestEvaluation(tx: Tx) {
  return tx
    .selectDistinctOn([s.evaluations.jobId], {
      jobId: s.evaluations.jobId,
      score: s.evaluations.score,
      humanScore: s.evaluations.humanScore,
      accion: s.evaluations.accion,
      model: s.evaluations.model,
      locationOk: s.evaluations.locationOk,
    })
    .from(s.evaluations)
    .orderBy(s.evaluations.jobId, desc(s.evaluations.createdAt))
    .as("latest");
}

export async function listApplications(userId: string): Promise<ApplicationView[]> {
  return withUser(userId, async (tx) => {
    const latest = latestEvaluation(tx);
    const rows = await tx
      .select({
        id: s.applications.id,
        jobId: s.applications.jobId,
        title: s.jobs.title,
        company: s.jobs.companyRaw,
        status: s.jobs.status,
        appliedAt: s.applications.appliedAt,
        channel: s.applications.channel,
        outcome: s.applications.outcome,
        outcomeAt: s.applications.outcomeAt,
        outcomeNote: s.applications.outcomeNote,
        score: latest.score,
        accion: latest.accion,
        model: latest.model,
      })
      .from(s.applications)
      .innerJoin(s.jobs, eq(s.jobs.id, s.applications.jobId))
      .leftJoin(latest, eq(latest.jobId, s.applications.jobId))
      .orderBy(desc(s.applications.appliedAt), desc(s.applications.createdAt));
    return rows.map((r) => ({
      ...r,
      appliedAt: r.appliedAt?.toISOString().slice(0, 10) ?? null,
      outcomeAt: r.outcomeAt?.toISOString().slice(0, 10) ?? null,
      outcome: asOutcome(r.outcome),
    }));
  });
}

/** Reporte de calibración con ofertas reales: cada oferta evaluada con su postulación si la hay. */
export async function getFeedbackReport(userId: string): Promise<FeedbackReport> {
  return withUser(userId, async (tx) => {
    const latest = latestEvaluation(tx);
    const rows = await tx
      .select({
        jobId: s.jobs.id,
        score: latest.score,
        humanScore: latest.humanScore,
        accion: latest.accion,
        model: latest.model,
        locationOk: latest.locationOk,
        outcome: s.applications.outcome,
        applicationId: s.applications.id,
      })
      .from(s.jobs)
      .innerJoin(latest, eq(latest.jobId, s.jobs.id))
      .leftJoin(s.applications, eq(s.applications.jobId, s.jobs.id));
    const feedbackRows: FeedbackRow[] = rows.map((r) => ({
      jobId: r.jobId,
      score: r.score,
      humanScore: r.humanScore,
      accion: r.accion,
      model: r.model,
      locationOk: r.locationOk,
      outcome: r.applicationId ? asOutcome(r.outcome) : null,
    }));
    return buildFeedbackReport(feedbackRows);
  });
}

export async function setApplicationOutcome(
  userId: string,
  applicationId: string,
  outcome: ApplicationOutcome,
  note: string | null,
): Promise<void> {
  await withUser(userId, async (tx) => {
    const updated = await tx
      .update(s.applications)
      .set({
        outcome,
        outcomeAt: outcome === "sin_respuesta" ? null : new Date(),
        outcomeNote: note,
      })
      .where(and(eq(s.applications.id, applicationId), eq(s.applications.userId, userId)))
      .returning({ id: s.applications.id });
    if (!updated.length) throw new Error("postulación inexistente");
  });
}
