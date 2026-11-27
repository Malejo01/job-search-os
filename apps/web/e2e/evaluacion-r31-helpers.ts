import * as s from "@job-search-os/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { ownerDb } from "./helpers";

/**
 * Datos de los e2e de R31-05 y R31-10 (calibración y pregunta de un toque). Todo inventado. Lo que muestran
 * depende de `JOB_CARD`: el runner lo sabe por `E2E_JOB_CARD_MODE`, que fija `playwright.config.ts` igual que
 * `E2E_ASSISTANT_MODE` (`testers` = encendida para admins y testers; ausente u `off` = apagada).
 */
export const JOB_CARD_MODE = process.env.E2E_JOB_CARD_MODE ?? "off";

type Seed = {
  userId: string;
  tag: string;
  title: string;
  promptVersion?: string;
  discipline?: (typeof s.discipline.enumValues)[number];
  blockers?: string[];
  checklist?: unknown;
  verdict?: "de_acuerdo" | "en_desacuerdo" | null;
};

/** Una oferta evaluada de la persona. Devuelve los ids para limpiar y para mirar lo marcado. */
export async function seedEvaluatedJob(
  seed: Seed,
): Promise<{ jobId: string; evaluationId: string }> {
  const { db, close } = ownerDb();
  try {
    const [job] = await db
      .insert(s.jobs)
      .values({
        userId: seed.userId,
        companyRaw: `Empresa ${seed.tag}`,
        title: seed.title,
        titleNormalized: seed.title.toLowerCase(),
        canonicalUrl: `https://example.com/e2e-r31/${seed.tag}/${seed.userId}/${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 8)}`,
        locationRaw: "Rosario, Argentina",
        modality: "presencial",
        status: "evaluada",
        jdText: `Descripción ficticia de ${seed.title}.`,
        flags: [],
        firstSeenAt: new Date(),
      })
      .returning({ id: s.jobs.id });
    const [ev] = await db
      .insert(s.evaluations)
      .values({
        jobId: job!.id,
        userId: seed.userId,
        criteriaVersion: 1,
        promptVersion: seed.promptVersion ?? "evaluate_job@v1.5.0",
        model: "fake",
        hadFullJd: true,
        score: 7,
        locationOk: "ok",
        modality: "presencial",
        discipline: seed.discipline ?? "abogacia",
        matchFuerte: [],
        gaps: [],
        bloqueadoresDuros: seed.blockers ?? [],
        senalesPositivas: [],
        veredicto: "Evaluación de prueba (e2e).",
        accion: "aplicar",
        humanVerdict: seed.verdict ?? null,
        humanVerdictAt: seed.verdict ? new Date() : null,
        ...(seed.checklist ? { decision: { checklist: seed.checklist } } : {}),
      })
      .returning({ id: s.evaluations.id });
    return { jobId: job!.id, evaluationId: ev!.id };
  } finally {
    await close();
  }
}

export async function deleteJobs(jobIds: string[]): Promise<void> {
  if (!jobIds.length) return;
  const { db, close } = ownerDb();
  try {
    await db.delete(s.jobs).where(inArray(s.jobs.id, jobIds));
  } finally {
    await close();
  }
}

export async function verdictOf(jobId: string): Promise<{
  humanVerdict: string | null;
  humanNote: string | null;
  humanScore: number | null;
} | null> {
  const { db, close } = ownerDb();
  try {
    const [row] = await db
      .select({
        humanVerdict: s.evaluations.humanVerdict,
        humanNote: s.evaluations.humanNote,
        humanScore: s.evaluations.humanScore,
      })
      .from(s.evaluations)
      .where(eq(s.evaluations.jobId, jobId))
      .limit(1);
    return row ?? null;
  } finally {
    await close();
  }
}

/** El admin de los e2e para las funciones `admin_*` de la base (rls/0073 exige `app_admins`). */
export async function ensureAppAdmin(userId: string): Promise<void> {
  const { db, close } = ownerDb();
  try {
    await db.insert(s.appAdmins).values({ userId }).onConflictDoNothing();
  } finally {
    await close();
  }
}

/** Respuestas guardadas de una persona (para comprobar y para limpiar). */
export async function requirementAnswersOf(
  userId: string,
): Promise<{ reqKey: string; answer: string; note: string | null }[]> {
  const { db, close } = ownerDb();
  try {
    return await db
      .select({
        reqKey: s.requirementAnswers.reqKey,
        answer: s.requirementAnswers.answer,
        note: s.requirementAnswers.note,
      })
      .from(s.requirementAnswers)
      .where(eq(s.requirementAnswers.userId, userId));
  } finally {
    await close();
  }
}

export async function deleteRequirementAnswers(userId: string): Promise<void> {
  const { db, close } = ownerDb();
  try {
    await db.delete(s.requirementAnswers).where(and(eq(s.requirementAnswers.userId, userId)));
  } finally {
    await close();
  }
}
