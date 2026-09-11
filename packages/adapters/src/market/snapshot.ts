import { schema as s, type Db } from "@job-search-os/db";
import { computeDemand, weekStartOf, type SkillDemand } from "@job-search-os/pipeline";
import { and, desc, eq, gte, inArray } from "drizzle-orm";

/**
 * Snapshot de mercado (adelanto de JS-031, sin LLM): demanda ponderada por skill a partir de
 * job_skills y del score de la última evaluación de cada oferta. Escribe market_snapshots
 * para (usuario, semana). Corre como servicio (dueño) y filtra por user_id explícito.
 */
export type SnapshotOptions = {
  userId: string;
  /** Lunes de la semana (YYYY-MM-DD); default: semana actual. */
  weekStart?: string;
  /** Solo ofertas vistas desde esta fecha; default: todas las del usuario con skills. */
  since?: Date;
  now?: () => Date;
};

export type SnapshotResult = {
  weekStart: string;
  jobs: number;
  jobsWithoutScore: number;
  skills: number;
  demand: SkillDemand[];
};

export async function buildMarketSnapshot(
  db: Db,
  options: SnapshotOptions,
): Promise<SnapshotResult> {
  const now = options.now?.() ?? new Date();
  const weekStart = options.weekStart ?? weekStartOf(now);

  const conds = [eq(s.jobs.userId, options.userId)];
  if (options.since) conds.push(gte(s.jobs.firstSeenAt, options.since));
  const jobs = await db
    .select({ id: s.jobs.id })
    .from(s.jobs)
    .where(and(...conds));
  if (!jobs.length) return { weekStart, jobs: 0, jobsWithoutScore: 0, skills: 0, demand: [] };
  const jobIds = jobs.map((j) => j.id);

  const skillRows = await db
    .select({
      jobId: s.jobSkills.jobId,
      slug: s.skills.slug,
      skillId: s.skills.id,
      isMust: s.jobSkills.isMust,
    })
    .from(s.jobSkills)
    .innerJoin(s.skills, eq(s.skills.id, s.jobSkills.skillId))
    .where(inArray(s.jobSkills.jobId, jobIds));

  // Score de la última evaluación por job (human_score si Mauro lo cargó, si no el del modelo)
  const evals = await db
    .selectDistinctOn([s.evaluations.jobId], {
      jobId: s.evaluations.jobId,
      score: s.evaluations.score,
      humanScore: s.evaluations.humanScore,
    })
    .from(s.evaluations)
    .where(inArray(s.evaluations.jobId, jobIds))
    .orderBy(s.evaluations.jobId, desc(s.evaluations.createdAt));
  const scoreByJob = new Map(evals.map((e) => [e.jobId, e.humanScore ?? e.score]));

  const byJob = new Map<string, { slug: string; isMust: boolean }[]>();
  for (const r of skillRows) {
    byJob.set(r.jobId, [...(byJob.get(r.jobId) ?? []), { slug: r.slug, isMust: r.isMust }]);
  }
  const input = [...byJob].map(([jobId, skills]) => ({
    jobId,
    score: scoreByJob.get(jobId) ?? null,
    skills,
  }));
  const demand = computeDemand(input);
  const skillIdBySlug = new Map(skillRows.map((r) => [r.slug, r.skillId]));

  await db.transaction(async (tx) => {
    await tx
      .delete(s.marketSnapshots)
      .where(
        and(
          eq(s.marketSnapshots.userId, options.userId),
          eq(s.marketSnapshots.weekStart, weekStart),
        ),
      );
    if (demand.length) {
      await tx.insert(s.marketSnapshots).values(
        demand.map((d) => ({
          userId: options.userId,
          weekStart,
          skillId: skillIdBySlug.get(d.slug)!,
          mentions: d.mentions,
          mustMentions: d.mustMentions,
          weightedDemand: d.weightedDemand,
        })),
      );
    }
  });

  return {
    weekStart,
    jobs: input.length,
    jobsWithoutScore: input.filter((j) => j.score === null).length,
    skills: demand.length,
    demand,
  };
}
