import { schema as s } from "@job-search-os/db";
import {
  applicationEffect,
  availableEvents,
  correctionTargets,
  correctStatus,
  transition,
  type Adjustment,
  type ApplicationOutcome,
  type JobEvent,
  type JobStatus,
} from "@job-search-os/pipeline";
import { and, desc, eq } from "drizzle-orm";
import { withUser } from "./db";
import { evaluatingSql } from "./jobs";
import { preScoresFor, type PreScoreView } from "./prescore";

/**
 * Detalle y acciones de una oferta (JS-016). Lecturas y escrituras con el rol de la app y
 * app.user_id fijado (RLS). jobs.status nunca se escribe directo: siempre transition().
 */
export type EvaluationView = {
  id: string;
  score: number;
  scoreModel: number | null;
  accion: string;
  accionSugerida: string | null;
  promptVersion: string;
  model: string;
  hadFullJd: boolean;
  locationOk: string;
  modality: string;
  discipline: string;
  englishRequired: string;
  companyType: string | null;
  yearsRequired: number | null;
  matchFuerte: string[];
  gaps: string[];
  bloqueadores: string[];
  riesgos: string[];
  senales: string[];
  veredicto: string;
  adjustments: Adjustment[];
  humanScore: number | null;
  humanNote: string | null;
  createdAt: string;
};

export type JobDetail = {
  id: string;
  title: string;
  company: string;
  status: JobStatus;
  locationRaw: string | null;
  /** Link a la publicación original (canonical_url o, si no hay, la URL de alguna fuente). */
  url: string | null;
  countriesAllowed: string[] | null;
  modality: string | null;
  contractType: string | null;
  salaryMinUsd: number | null;
  salaryMaxUsd: number | null;
  salaryPeriod: string | null;
  weeklyHours: number | null;
  candidatesCount: number | null;
  badges: string[];
  flags: string[];
  prefilterReason: string | null;
  jdText: string | null;
  postedAt: string | null;
  firstSeenAt: string;
  sources: { kind: string; name: string | null; url: string | null; seenAt: string }[];
  evaluation: EvaluationView | null;
  /** Modo offline: lo que se sabe sin LLM (null si ya hay evaluación o la oferta fue descartada). */
  preScore: PreScoreView | null;
  application: { appliedAt: string | null; outcome: string | null } | null;
  /** Eventos manuales válidos desde el estado actual (para los botones). */
  events: JobEvent[];
  /** Evaluación en cola o en curso (JS-027): la página se actualiza sola hasta que termine. */
  evaluating: boolean;
  /** Estados a los que se puede corregir a mano (JS-028); vacío si no hay nada que corregir. */
  corrections: JobStatus[];
};

/** Eventos que puede disparar la persona desde la UI (el resto los dispara el pipeline). */
export const MANUAL_EVENTS: readonly JobEvent[] = [
  "apply",
  "interview",
  "offer",
  "reject",
  "auto_reject",
  "discard",
  "close",
];

export async function getJobDetail(userId: string, jobId: string): Promise<JobDetail | null> {
  return withUser(userId, async (tx) => {
    const [job] = await tx.select().from(s.jobs).where(eq(s.jobs.id, jobId)).limit(1);
    if (!job) return null;
    const [queued] = await tx
      .select({ evaluating: evaluatingSql() })
      .from(s.jobs)
      .where(eq(s.jobs.id, jobId));
    const sources = await tx
      .select({
        kind: s.jobSources.kind,
        name: s.jobSources.sourceName,
        url: s.jobSources.url,
        seenAt: s.jobSources.seenAt,
      })
      .from(s.jobSources)
      .where(eq(s.jobSources.jobId, jobId))
      .orderBy(s.jobSources.seenAt);
    const [ev] = await tx
      .select()
      .from(s.evaluations)
      .where(eq(s.evaluations.jobId, jobId))
      .orderBy(desc(s.evaluations.createdAt))
      .limit(1);
    const [app] = await tx
      .select({ appliedAt: s.applications.appliedAt, outcome: s.applications.outcome })
      .from(s.applications)
      .where(eq(s.applications.jobId, jobId))
      .orderBy(desc(s.applications.createdAt))
      .limit(1);
    const pre =
      !ev && job.status !== "descartada_prefiltro"
        ? ((
            await preScoresFor(tx, userId, [
              { id: job.id, flags: job.flags ?? [], salaryMaxUsd: job.salaryMaxUsd },
            ])
          ).get(job.id) ?? null)
        : null;
    const decision = (ev?.decision ?? null) as {
      adjustments?: Adjustment[];
      accion_sugerida?: string;
    } | null;

    return {
      id: job.id,
      title: job.title,
      company: job.companyRaw,
      status: job.status,
      locationRaw: job.locationRaw,
      url: job.canonicalUrl ?? sources.find((x) => x.url)?.url ?? null,
      countriesAllowed: job.countriesAllowed,
      modality: job.modality,
      contractType: job.contractType,
      salaryMinUsd: job.salaryMinUsd,
      salaryMaxUsd: job.salaryMaxUsd,
      salaryPeriod: job.salaryPeriod,
      weeklyHours: job.weeklyHours,
      candidatesCount: job.candidatesCount,
      badges: job.badges ?? [],
      flags: job.flags ?? [],
      prefilterReason: job.prefilterReason,
      jdText: job.jdText,
      postedAt: job.postedAt?.toISOString() ?? null,
      firstSeenAt: job.firstSeenAt.toISOString(),
      sources: sources.map((x) => ({ ...x, seenAt: x.seenAt.toISOString() })),
      evaluation: ev
        ? {
            id: ev.id,
            score: ev.score,
            scoreModel: ev.scoreModel,
            accion: ev.accion,
            accionSugerida: decision?.accion_sugerida ?? null,
            promptVersion: ev.promptVersion,
            model: ev.model,
            hadFullJd: ev.hadFullJd,
            locationOk: ev.locationOk,
            modality: ev.modality,
            discipline: ev.discipline,
            englishRequired: ev.englishRequired,
            companyType: ev.companyType,
            yearsRequired: ev.yearsRequired,
            matchFuerte: ev.matchFuerte,
            gaps: ev.gaps,
            bloqueadores: ev.bloqueadoresDuros,
            riesgos: ev.riesgos,
            senales: ev.senalesPositivas,
            veredicto: ev.veredicto,
            adjustments: decision?.adjustments ?? [],
            humanScore: ev.humanScore,
            humanNote: ev.humanNote,
            createdAt: ev.createdAt.toISOString(),
          }
        : null,
      preScore: pre,
      application: app
        ? { appliedAt: app.appliedAt?.toISOString() ?? null, outcome: app.outcome }
        : null,
      events: availableEvents(job.status).filter((e) => MANUAL_EVENTS.includes(e)),
      evaluating: Boolean(queued?.evaluating),
      corrections: correctionTargets(job.status, {
        hasEvaluation: Boolean(ev),
        hasJd: Boolean(job.jdText?.trim()),
      }),
    };
  });
}

/** Evento manual → resultado de la postulación (si existe). `close` desde aplicada = cerrada antes de responder. */
const EVENT_OUTCOME: Partial<Record<JobEvent, ApplicationOutcome>> = {
  reject: "rechazo_humano",
  auto_reject: "rechazo_automatico_otro",
  interview: "entrevista",
  offer: "oferta",
  close: "cerrada_antes",
};

/** Cambia el estado con transition(); en `apply` deja constancia en applications y los eventos posteriores actualizan su resultado. */
export async function applyJobEvent(
  userId: string,
  jobId: string,
  event: JobEvent,
): Promise<JobStatus> {
  return withUser(userId, async (tx) => {
    const [job] = await tx
      .select({ status: s.jobs.status })
      .from(s.jobs)
      .where(eq(s.jobs.id, jobId))
      .limit(1);
    if (!job) throw new Error("oferta inexistente");
    const next = transition(job.status, event); // lanza InvalidTransitionError si no corresponde
    const now = new Date();
    await tx.update(s.jobs).set({ status: next, updatedAt: now }).where(eq(s.jobs.id, jobId));
    if (event === "apply") {
      const [existing] = await tx
        .select({ id: s.applications.id })
        .from(s.applications)
        .where(eq(s.applications.jobId, jobId))
        .limit(1);
      if (!existing) {
        await tx.insert(s.applications).values({ jobId, userId, appliedAt: now });
      }
    }
    // Feedback loop (JS-036): el evento sobre la oferta deja el resultado en la postulación
    const outcome = EVENT_OUTCOME[event];
    if (outcome) {
      await tx
        .update(s.applications)
        .set({ outcome, outcomeAt: now })
        .where(and(eq(s.applications.jobId, jobId), eq(s.applications.userId, userId)));
    }
    return next;
  });
}

/**
 * Corrección manual de estado (JS-028): valida con correctStatus() (pipeline) y deja la
 * postulación coherente con el estado corregido. No pasa por transition() porque no es un
 * evento de la oferta sino el arreglo de uno mal marcado.
 */
export async function correctJobStatus(
  userId: string,
  jobId: string,
  to: JobStatus,
): Promise<{ from: JobStatus; to: JobStatus }> {
  return withUser(userId, async (tx) => {
    const [job] = await tx
      .select({ status: s.jobs.status, jdText: s.jobs.jdText })
      .from(s.jobs)
      .where(eq(s.jobs.id, jobId))
      .limit(1);
    if (!job) throw new Error("oferta inexistente");
    const [ev] = await tx
      .select({ id: s.evaluations.id })
      .from(s.evaluations)
      .where(eq(s.evaluations.jobId, jobId))
      .limit(1);
    // Lanza InvalidCorrectionError si la corrección no vale
    const next = correctStatus(job.status, to, {
      hasEvaluation: Boolean(ev),
      hasJd: Boolean(job.jdText?.trim()),
    });
    const now = new Date();
    await tx.update(s.jobs).set({ status: next, updatedAt: now }).where(eq(s.jobs.id, jobId));

    const mine = and(eq(s.applications.jobId, jobId), eq(s.applications.userId, userId));
    const effect = applicationEffect(next);
    if (effect.kind === "remove") {
      await tx.delete(s.applications).where(mine);
    } else {
      const [existing] = await tx
        .select({ id: s.applications.id })
        .from(s.applications)
        .where(mine)
        .limit(1);
      if (existing) {
        await tx
          .update(s.applications)
          .set({ outcome: effect.outcome, outcomeAt: effect.outcome ? now : null })
          .where(mine);
      } else if (effect.kind === "ensure") {
        await tx.insert(s.applications).values({
          jobId,
          userId,
          appliedAt: now,
          outcome: effect.outcome,
          outcomeAt: effect.outcome ? now : null,
        });
      }
    }
    return { from: job.status, to: next };
  });
}

/** Score humano (0–10, medio punto) + nota sobre la última evaluación. */
export async function saveHumanScore(
  userId: string,
  evaluationId: string,
  humanScore: number | null,
  humanNote: string | null,
): Promise<void> {
  if (humanScore !== null && (humanScore < 0 || humanScore > 10 || (humanScore * 2) % 1 !== 0)) {
    throw new Error("el score humano va de 0 a 10 en pasos de 0,5");
  }
  await withUser(userId, async (tx) => {
    const updated = await tx
      .update(s.evaluations)
      .set({ humanScore, humanNote })
      .where(and(eq(s.evaluations.id, evaluationId), eq(s.evaluations.userId, userId)))
      .returning({ id: s.evaluations.id });
    if (!updated.length) throw new Error("evaluación inexistente");
  });
}
