import { schema as s } from "@job-search-os/db";
import { preScore, type CriteriaRules, type PreScore } from "@job-search-os/pipeline";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { Tx } from "./db";

/**
 * Pre-score determinista por oferta (modo offline): job_skills × skill_levels + flags + salario
 * contra el piso de los criterios. Se calcula al leer (no se guarda): cambia solo si cambian
 * los niveles, los flags o la JD.
 */
export type PreScoreView = PreScore & { skillsMentioned: number };

export async function preScoresFor(
  tx: Tx,
  userId: string,
  jobs: readonly { id: string; flags: string[]; salaryMaxUsd: number | null }[],
): Promise<Map<string, PreScoreView>> {
  const out = new Map<string, PreScoreView>();
  if (!jobs.length) return out;
  const [criteria] = await tx
    .select({ rules: s.evaluationCriteria.rules })
    .from(s.evaluationCriteria)
    .where(and(eq(s.evaluationCriteria.userId, userId), eq(s.evaluationCriteria.active, true)))
    .orderBy(desc(s.evaluationCriteria.version))
    .limit(1);
  const salaryFloorUsd =
    (criteria?.rules as CriteriaRules | undefined)?.salary_floor_usd_monthly ?? null;

  const skillRows = await tx
    .select({
      jobId: s.jobSkills.jobId,
      slug: s.skills.slug,
      name: s.skills.name,
      isMust: s.jobSkills.isMust,
      level: s.skillLevels.level,
    })
    .from(s.jobSkills)
    .innerJoin(s.skills, eq(s.skills.id, s.jobSkills.skillId))
    .leftJoin(
      s.skillLevels,
      and(eq(s.skillLevels.skillId, s.jobSkills.skillId), eq(s.skillLevels.userId, userId)),
    )
    .where(
      inArray(
        s.jobSkills.jobId,
        jobs.map((j) => j.id),
      ),
    );
  const byJob = new Map<string, typeof skillRows>();
  for (const r of skillRows) byJob.set(r.jobId, [...(byJob.get(r.jobId) ?? []), r]);

  for (const job of jobs) {
    const skills = byJob.get(job.id) ?? [];
    out.set(job.id, {
      ...preScore({
        flags: job.flags,
        skills: skills.map((k) => ({
          slug: k.slug,
          name: k.name,
          isMust: k.isMust,
          level: k.level,
        })),
        salaryMaxUsd: job.salaryMaxUsd,
        salaryFloorUsd,
      }),
      skillsMentioned: skills.length,
    });
  }
  return out;
}
