import { schema as s } from "@job-search-os/db";
import {
  englishIsNotAGap,
  isEnglishSkillSlug,
  monthlyUsd,
  preScore,
  type CriteriaRules,
  type PreScore,
} from "@job-search-os/pipeline";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { Tx } from "./db";

/**
 * Pre-score determinista por oferta (modo offline): job_skills × skill_levels + flags + salario
 * contra el piso de los criterios. Se calcula al leer (no se guarda): cambia solo si cambian
 * los niveles, los flags o la JD.
 */
export type PreScoreView = PreScore & { skillsMentioned: number };

/** `jobs.salary_period` es texto libre en la base: solo estos tres valores se convierten a mensual. */
function knownPeriod(period: string | null | undefined): "mensual" | "anual" | "hora" | null {
  return period === "mensual" || period === "anual" || period === "hora" ? period : null;
}

/**
 * `salaryMaxUsd` se compara con el piso mensual ya mensualizado según `salaryPeriod` (anual / 12,
 * hora × 160). Sin período conocido no se supone mensual: el salario cuenta como desconocido.
 */
export async function preScoresFor(
  tx: Tx,
  userId: string,
  jobs: readonly {
    id: string;
    flags: string[];
    salaryMaxUsd: number | null;
    /** Opcional: sin período, el salario no se puede mensualizar y no penaliza. */
    salaryPeriod?: string | null;
  }[],
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

  // Texto de los avisos: si uno está en español y no pide inglés, el inglés no es una brecha.
  // Solo se lee el de los avisos con inglés faltante, para no traer todas las JD de la lista.
  const withEnglishGap = [
    ...new Set(
      skillRows.filter((k) => isEnglishSkillSlug(k.slug) && (k.level ?? 0) < 2).map((k) => k.jobId),
    ),
  ];
  const jdRows = withEnglishGap.length
    ? await tx
        .select({ id: s.jobs.id, jdText: s.jobs.jdText })
        .from(s.jobs)
        .where(inArray(s.jobs.id, withEnglishGap))
    : [];
  const jdById = new Map(jdRows.map((r) => [r.id, r.jdText]));

  for (const job of jobs) {
    const hideEnglish = englishIsNotAGap(jdById.get(job.id) ?? null, null);
    // Solo se quita lo que no llega a nivel productivo (los faltantes); lo que ya tiene se conserva
    const skills = (byJob.get(job.id) ?? []).filter(
      (k) => !(hideEnglish && isEnglishSkillSlug(k.slug) && (k.level ?? 0) < 2),
    );
    out.set(job.id, {
      ...preScore({
        flags: job.flags,
        skills: skills.map((k) => ({
          slug: k.slug,
          name: k.name,
          isMust: k.isMust,
          level: k.level,
        })),
        salaryMaxUsd: monthlyUsd(job.salaryMaxUsd, knownPeriod(job.salaryPeriod)),
        salaryFloorUsd,
      }),
      skillsMentioned: skills.length,
    });
  }
  return out;
}
