import { schema as s } from "@job-search-os/db";
import type { FirstStepsFacts } from "@job-search-os/pipeline";
import { and, desc, eq, gt, isNotNull, isNull } from "drizzle-orm";
import { withUser } from "./db";

/**
 * Hechos de la checklist «Primeros pasos»: una transacción con consultas de existencia (limit 1)
 * y la mejor evaluada sin opinión. No reusa las funciones pesadas de skills ni postulaciones.
 * `emailDeclined` sale de una cookie, así que lo completa quien llama.
 */
export async function getFirstStepsFacts(
  userId: string,
): Promise<Omit<FirstStepsFacts, "emailDeclined">> {
  return withUser(userId, async (tx) => {
    const [skill] = await tx
      .select({ id: s.skillLevels.skillId })
      .from(s.skillLevels)
      .where(and(eq(s.skillLevels.userId, userId), gt(s.skillLevels.level, 0)))
      .limit(1);
    const [job] = await tx
      .select({ id: s.jobs.id })
      .from(s.jobs)
      .where(eq(s.jobs.userId, userId))
      .limit(1);
    const [verdict] = await tx
      .select({ id: s.evaluations.id })
      .from(s.evaluations)
      .where(and(eq(s.evaluations.userId, userId), isNotNull(s.evaluations.humanVerdict)))
      .limit(1);
    const [application] = await tx
      .select({ id: s.applications.id })
      .from(s.applications)
      .where(eq(s.applications.userId, userId))
      .limit(1);
    const [email] = await tx
      .select({ id: s.inboundEmails.id })
      .from(s.inboundEmails)
      .where(eq(s.inboundEmails.userId, userId))
      .limit(1);
    const [next] = await tx
      .select({ jobId: s.evaluations.jobId })
      .from(s.evaluations)
      .where(and(eq(s.evaluations.userId, userId), isNull(s.evaluations.humanVerdict)))
      .orderBy(desc(s.evaluations.score))
      .limit(1);
    return {
      skillsLoaded: Boolean(skill),
      hasJobs: Boolean(job),
      hasVerdict: Boolean(verdict),
      hasApplication: Boolean(application),
      hasEmail: Boolean(email),
      nextEvaluatedJobId: next?.jobId ?? null,
    };
  });
}
