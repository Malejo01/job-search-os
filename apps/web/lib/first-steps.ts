import { schema as s } from "@job-search-os/db";
import type { FirstStepsFacts } from "@job-search-os/pipeline";
import { sql } from "drizzle-orm";
import { withUser } from "./db";

/**
 * Hechos de la checklist «Primeros pasos»: una sola consulta con subconsultas de existencia y la
 * mejor evaluada sin opinión (C-7: antes eran 6 idas y vueltas en serie). Corre con RLS y además
 * filtra por `user_id`. No reusa las funciones pesadas de skills ni postulaciones.
 * `emailDeclined` sale de una cookie, así que lo completa quien llama.
 */
export async function getFirstStepsFacts(
  userId: string,
): Promise<Omit<FirstStepsFacts, "emailDeclined">> {
  return withUser(userId, async (tx) => {
    const [row] = await tx
      .select({
        skillsLoaded: sql<boolean>`exists (select 1 from ${s.skillLevels} where ${s.skillLevels.userId} = ${userId} and ${s.skillLevels.level} > 0)`,
        hasJobs: sql<boolean>`exists (select 1 from ${s.jobs} where ${s.jobs.userId} = ${userId})`,
        hasVerdict: sql<boolean>`exists (select 1 from ${s.evaluations} where ${s.evaluations.userId} = ${userId} and ${s.evaluations.humanVerdict} is not null)`,
        hasApplication: sql<boolean>`exists (select 1 from ${s.applications} where ${s.applications.userId} = ${userId})`,
        hasEmail: sql<boolean>`exists (select 1 from ${s.inboundEmails} where ${s.inboundEmails.userId} = ${userId})`,
        // Mejor evaluada sin opinión, con la regla de `compareJobPriority` (pipeline, N4-4): score
        // desc; a igual score, menos bloqueadores y después menos riesgos; job_id para que sea
        // determinista.
        nextEvaluatedJobId: sql<
          string | null
        >`(select ${s.evaluations.jobId} from ${s.evaluations} where ${s.evaluations.userId} = ${userId} and ${s.evaluations.humanVerdict} is null order by ${s.evaluations.score} desc, cardinality(${s.evaluations.bloqueadoresDuros}) asc, cardinality(${s.evaluations.riesgos}) asc, ${s.evaluations.jobId} asc limit 1)`,
      })
      // SELECT sin tabla: las seis respuestas en una sola ida y vuelta
      .from(sql`(select 1) as one`);
    return {
      skillsLoaded: Boolean(row?.skillsLoaded),
      hasJobs: Boolean(row?.hasJobs),
      hasVerdict: Boolean(row?.hasVerdict),
      hasApplication: Boolean(row?.hasApplication),
      hasEmail: Boolean(row?.hasEmail),
      nextEvaluatedJobId: row?.nextEvaluatedJobId ?? null,
    };
  });
}
