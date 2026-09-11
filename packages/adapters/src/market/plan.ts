import { schema as s, type Db } from "@job-search-os/db";
import { buildPlan, type PlanRow } from "@job-search-os/pipeline";
import { and, asc, desc, eq, inArray } from "drizzle-orm";

/**
 * Plan de formación (JS-034, determinista): toma el último snapshot de mercado del usuario,
 * lo cruza con skill_levels y closure_hours, calcula la prioridad
 * (demanda × (1 − nivel/3) × facilidad) y sincroniza learning_plan_items:
 * - skill nueva en el plan → fila `pendiente` con el mejor recurso aprobado (target_level >
 *   nivel, menos horas);
 * - skill que ya estaba → se actualiza la prioridad, se conservan estado y recurso;
 * - skill que ya no aplica (nivel 3) y estaba `pendiente` → se borra; `en_curso`/`cerrada` quedan.
 */
export type PlanBuildResult = {
  weekStart: string | null;
  rows: PlanRow[];
  inserted: number;
  updated: number;
  removed: number;
};

export async function buildLearningPlan(
  db: Db,
  options: { userId: string; weekStart?: string },
): Promise<PlanBuildResult> {
  const { userId } = options;
  const [latest] = await db
    .select({ weekStart: s.marketSnapshots.weekStart })
    .from(s.marketSnapshots)
    .where(
      options.weekStart
        ? and(
            eq(s.marketSnapshots.userId, userId),
            eq(s.marketSnapshots.weekStart, options.weekStart),
          )
        : eq(s.marketSnapshots.userId, userId),
    )
    .orderBy(desc(s.marketSnapshots.weekStart))
    .limit(1);
  if (!latest) return { weekStart: null, rows: [], inserted: 0, updated: 0, removed: 0 };
  const weekStart = latest.weekStart;

  const snapshot = await db
    .select({
      skillId: s.skills.id,
      slug: s.skills.slug,
      closureHours: s.skills.closureHours,
      mentions: s.marketSnapshots.mentions,
      mustMentions: s.marketSnapshots.mustMentions,
      weightedDemand: s.marketSnapshots.weightedDemand,
    })
    .from(s.marketSnapshots)
    .innerJoin(s.skills, eq(s.skills.id, s.marketSnapshots.skillId))
    .where(and(eq(s.marketSnapshots.userId, userId), eq(s.marketSnapshots.weekStart, weekStart)));
  const levels = await db
    .select({ skillId: s.skillLevels.skillId, level: s.skillLevels.level })
    .from(s.skillLevels)
    .where(eq(s.skillLevels.userId, userId));
  const levelBySkill = new Map(levels.map((l) => [l.skillId, l.level]));

  const rows = buildPlan(
    snapshot.map((r) => ({
      slug: r.slug,
      mentions: r.mentions,
      mustMentions: r.mustMentions,
      weightedDemand: r.weightedDemand,
      level: levelBySkill.get(r.skillId) ?? null,
      closureHours: r.closureHours,
    })),
  );
  const skillIdBySlug = new Map(snapshot.map((r) => [r.slug, r.skillId]));

  const existing = await db
    .select({
      id: s.learningPlanItems.id,
      skillId: s.learningPlanItems.skillId,
      status: s.learningPlanItems.status,
      resourceId: s.learningPlanItems.resourceId,
    })
    .from(s.learningPlanItems)
    .where(eq(s.learningPlanItems.userId, userId));
  const existingBySkill = new Map(existing.map((e) => [e.skillId, e]));

  // Mejor recurso aprobado por skill: target_level > nivel actual, menos horas
  const wantedSkillIds = rows.map((r) => skillIdBySlug.get(r.slug)!);
  const resources = wantedSkillIds.length
    ? await db
        .select({
          id: s.learningResources.id,
          skillId: s.learningResources.skillId,
          targetLevel: s.learningResources.targetLevel,
          hours: s.learningResources.hours,
        })
        .from(s.learningResources)
        .where(
          and(
            eq(s.learningResources.approved, true),
            inArray(s.learningResources.skillId, wantedSkillIds),
          ),
        )
        .orderBy(asc(s.learningResources.hours))
    : [];
  const bestResource = (skillId: string, level: number | null) =>
    resources.find((r) => r.skillId === skillId && r.targetLevel > (level ?? 0))?.id ?? null;

  let inserted = 0;
  let updated = 0;
  let removed = 0;
  await db.transaction(async (tx) => {
    for (const row of rows) {
      const skillId = skillIdBySlug.get(row.slug)!;
      const prev = existingBySkill.get(skillId);
      if (prev) {
        await tx
          .update(s.learningPlanItems)
          .set({
            priority: row.priority,
            resourceId: prev.resourceId ?? bestResource(skillId, row.level),
          })
          .where(eq(s.learningPlanItems.id, prev.id));
        updated++;
      } else {
        await tx.insert(s.learningPlanItems).values({
          userId,
          skillId,
          resourceId: bestResource(skillId, row.level),
          priority: row.priority,
          status: "pendiente",
        });
        inserted++;
      }
    }
    const stillWanted = new Set(wantedSkillIds);
    for (const e of existing) {
      if (!stillWanted.has(e.skillId) && e.status === "pendiente") {
        await tx.delete(s.learningPlanItems).where(eq(s.learningPlanItems.id, e.id));
        removed++;
      }
    }
  });

  return { weekStart, rows, inserted, updated, removed };
}
