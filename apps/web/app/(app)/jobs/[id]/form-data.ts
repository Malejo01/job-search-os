import { schema as s } from "@job-search-os/db";
import { and, asc, eq } from "drizzle-orm";
import { withUser } from "@/lib/db";

/** Respuestas del formulario ya aprobadas para esta oferta (application_answers), con RLS. */
export async function getSavedFormAnswers(
  userId: string,
  jobId: string,
): Promise<{ question: string; answer: string }[]> {
  return withUser(userId, (tx) =>
    tx
      .select({ question: s.applicationAnswers.question, answer: s.applicationAnswers.answer })
      .from(s.applicationAnswers)
      .where(and(eq(s.applicationAnswers.userId, userId), eq(s.applicationAnswers.jobId, jobId)))
      .orderBy(asc(s.applicationAnswers.position)),
  );
}
