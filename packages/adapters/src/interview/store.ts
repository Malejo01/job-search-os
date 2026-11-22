import { schema as s, type Db } from "@job-search-os/db";
import type { InterviewFeedbackOutput, InterviewSeniority } from "@job-search-os/pipeline";
import { and, asc, desc, eq, sql } from "drizzle-orm";

/**
 * Lectura y escritura de las simulaciones. `db` es una transacción del rol de la app con `app.user_id` fijado
 * (RLS de dueño); aun así cada consulta filtra por `user_id`: dos defensas, no una.
 */
export type InterviewSessionRow = typeof s.interviewSessions.$inferSelect;
export type InterviewAnswerRow = typeof s.interviewAnswers.$inferSelect;

export type NewInterviewSession = {
  id: string;
  userId: string;
  source:
    | { kind: "job"; jobId: string }
    | { kind: "career"; career: string; seniority: InterviewSeniority };
  title: string;
  questions: string[];
};

export async function insertInterviewSession(db: Db, input: NewInterviewSession): Promise<void> {
  await db.insert(s.interviewSessions).values({
    id: input.id,
    userId: input.userId,
    sourceKind: input.source.kind,
    jobId: input.source.kind === "job" ? input.source.jobId : null,
    career: input.source.kind === "career" ? input.source.career : null,
    seniority: input.source.kind === "career" ? input.source.seniority : null,
    title: input.title,
    questions: input.questions,
  });
}

export async function loadInterviewSession(
  db: Db,
  userId: string,
  sessionId: string,
): Promise<{ session: InterviewSessionRow; answers: InterviewAnswerRow[] } | null> {
  const [session] = await db
    .select()
    .from(s.interviewSessions)
    .where(and(eq(s.interviewSessions.id, sessionId), eq(s.interviewSessions.userId, userId)))
    .limit(1);
  if (!session) return null;
  const answers = await db
    .select()
    .from(s.interviewAnswers)
    .where(and(eq(s.interviewAnswers.sessionId, sessionId), eq(s.interviewAnswers.userId, userId)))
    .orderBy(asc(s.interviewAnswers.position));
  return { session, answers };
}

/** Simulaciones recientes de la persona, con cuántas respuestas lleva cada una. */
export async function listInterviewSessions(
  db: Db,
  userId: string,
  limit = 5,
): Promise<{ id: string; title: string; status: string; createdAt: Date; answered: number }[]> {
  return db
    .select({
      id: s.interviewSessions.id,
      title: s.interviewSessions.title,
      status: s.interviewSessions.status,
      createdAt: s.interviewSessions.createdAt,
      answered: sql<number>`(select count(*)::int from ${s.interviewAnswers} a where a.session_id = ${s.interviewSessions.id})`,
    })
    .from(s.interviewSessions)
    .where(eq(s.interviewSessions.userId, userId))
    .orderBy(desc(s.interviewSessions.createdAt))
    .limit(limit);
}

/** La oferta de la persona sobre la que se practica; null si no existe o no es suya. */
export async function loadInterviewJob(
  db: Db,
  userId: string,
  jobId: string,
): Promise<{ title: string; company: string; description: string | null } | null> {
  const [job] = await db
    .select({ title: s.jobs.title, company: s.jobs.companyRaw, description: s.jobs.jdText })
    .from(s.jobs)
    .where(and(eq(s.jobs.id, jobId), eq(s.jobs.userId, userId)))
    .limit(1);
  return job ?? null;
}

/**
 * Guarda la respuesta evaluada. Devuelve `duplicate` si esa posición ya estaba (un doble envío): no pisa nada.
 * La última respuesta cierra la simulación.
 */
export async function insertInterviewAnswer(
  db: Db,
  input: {
    userId: string;
    sessionId: string;
    position: number;
    answer: string;
    feedback: InterviewFeedbackOutput;
    model: string;
    isLast: boolean;
  },
): Promise<"ok" | "duplicate"> {
  const inserted = await db
    .insert(s.interviewAnswers)
    .values({
      sessionId: input.sessionId,
      userId: input.userId,
      position: input.position,
      answer: input.answer,
      clarity: input.feedback.clarity,
      relevance: input.feedback.relevance,
      star: input.feedback.star,
      tip: input.feedback.tip,
      example: input.feedback.example,
      model: input.model,
    })
    .onConflictDoNothing()
    .returning({ id: s.interviewAnswers.id });
  if (inserted.length === 0) return "duplicate";
  if (input.isLast) {
    await db
      .update(s.interviewSessions)
      .set({ status: "terminada", finishedAt: new Date() })
      .where(
        and(
          eq(s.interviewSessions.id, input.sessionId),
          eq(s.interviewSessions.userId, input.userId),
        ),
      );
  }
  return "ok";
}
