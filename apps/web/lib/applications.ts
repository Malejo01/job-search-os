import { schema as s } from "@job-search-os/db";
import {
  APPLICATION_OUTCOMES,
  buildFeedbackReport,
  FOLLOW_UP_SNOOZE_DAYS,
  followUpDue,
  type ApplicationOutcome,
  type FeedbackReport,
  type FeedbackRow,
} from "@job-search-os/pipeline";
import { and, desc, eq, inArray } from "drizzle-orm";
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
      humanVerdict: s.evaluations.humanVerdict,
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
        humanVerdict: latest.humanVerdict,
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
      humanVerdict: r.humanVerdict,
      accion: r.accion,
      model: r.model,
      locationOk: r.locationOk,
      outcome: r.applicationId ? asOutcome(r.outcome) : null,
    }));
    return buildFeedbackReport(feedbackRows);
  });
}

/** Postulación que pide seguimiento (ronda 113). */
export type FollowUpView = {
  jobId: string;
  title: string;
  company: string;
  status: string;
  /** Días desde la fecha de referencia (postulación, o entrevista si la hay). */
  daysSince: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Postulaciones que vencen hoy: una consulta con RLS; el vencimiento lo decide followUpDue (pipeline). */
export async function listFollowUps(userId: string, today: Date): Promise<FollowUpView[]> {
  return withUser(userId, async (tx) => {
    const rows = await tx
      .select({
        jobId: s.applications.jobId,
        title: s.jobs.title,
        company: s.jobs.companyRaw,
        status: s.jobs.status,
        appliedAt: s.applications.appliedAt,
        outcomeAt: s.applications.outcomeAt,
        followUpAt: s.applications.followUpAt,
      })
      .from(s.applications)
      .innerJoin(s.jobs, eq(s.jobs.id, s.applications.jobId))
      .where(inArray(s.jobs.status, ["aplicada", "entrevista"]));
    return rows
      .flatMap((r) => {
        const followUpAt = r.followUpAt ? new Date(`${r.followUpAt}T00:00:00Z`) : null;
        const { due } = followUpDue(
          { status: r.status, appliedAt: r.appliedAt, outcomeAt: r.outcomeAt, followUpAt },
          today,
        );
        if (!due) return [];
        const reference = (r.status === "entrevista" ? (r.outcomeAt ?? r.appliedAt) : r.appliedAt)!;
        return [
          {
            jobId: r.jobId,
            title: r.title,
            company: r.company,
            status: r.status,
            daysSince: Math.max(0, Math.floor((today.getTime() - reference.getTime()) / DAY_MS)),
            reference: reference.getTime(),
          },
        ];
      })
      .sort((a, b) => a.reference - b.reference)
      .map(({ reference: _reference, ...rest }) => rest);
  });
}

export async function countFollowUps(userId: string, today: Date): Promise<number> {
  return (await listFollowUps(userId, today)).length;
}

/** Posterga el seguimiento: `follow_up_at = hoy + days`. RLS limita la fila a la persona. */
export async function snoozeFollowUp(
  userId: string,
  jobId: string,
  days = FOLLOW_UP_SNOOZE_DAYS,
  today: Date = new Date(),
): Promise<void> {
  const until = new Date(today.getTime() + days * DAY_MS).toISOString().slice(0, 10);
  await withUser(userId, async (tx) => {
    const updated = await tx
      .update(s.applications)
      .set({ followUpAt: until })
      .where(and(eq(s.applications.jobId, jobId), eq(s.applications.userId, userId)))
      .returning({ id: s.applications.id });
    if (!updated.length) throw new Error("postulación inexistente");
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
