import { schema as s, type Db } from "@job-search-os/db";
import { buildPlan, isRoleKey, type PlanRow } from "@job-search-os/pipeline";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";

/**
 * Plan de formación (JS-034, determinista): toma el último snapshot de mercado del usuario,
 * lo cruza con skill_levels y closure_hours, calcula la prioridad
 * (demanda × (1 − nivel/3) × facilidad) y sincroniza learning_plan_items:
 * - skill nueva en el plan → fila `pendiente` con el mejor recurso aprobado (target_level >
 *   nivel, menos horas);
 * - skill que ya estaba → se actualiza la prioridad, se conservan estado y recurso;
 * - skill que ya no aplica (nivel 3) y estaba `pendiente` → se borra; `en_curso`/`cerrada` quedan.
 *
 * Respaldo del rol (ronda 38): con menos de 10 ofertas con skills y un `target_role` válido, la
 * demanda sale de `role_market_snapshots` de ese rol (pool global) en vez del snapshot del usuario.
 */
export type PlanBuildResult = {
  weekStart: string | null;
  rows: PlanRow[];
  inserted: number;
  updated: number;
  removed: number;
  /** De dónde salió la demanda: las ofertas del usuario o, con pocas, las del rol en el pool. */
  demandSource: "usuario" | "rol";
};

/** Con menos ofertas con skills que esto, la demanda sale del rol objetivo. */
export const MIN_OWN_JOBS_FOR_PLAN = 10;

type DemandRow = {
  skillId: string;
  slug: string;
  closureHours: number | null;
  mentions: number;
  mustMentions: number;
  weightedDemand: number;
};

/** Última semana de `role_market_snapshots` del rol; `weighted_demand` = menciones + obligatorias. */
async function loadRoleDemand(
  db: Db,
  role: string,
): Promise<{ weekStart: string; rows: DemandRow[] } | null> {
  const [latest] = await db
    .select({ weekStart: s.roleMarketSnapshots.weekStart })
    .from(s.roleMarketSnapshots)
    .where(eq(s.roleMarketSnapshots.role, role))
    .orderBy(desc(s.roleMarketSnapshots.weekStart))
    .limit(1);
  if (!latest) return null;
  const rows = await db
    .select({
      skillId: s.skills.id,
      slug: s.skills.slug,
      closureHours: s.skills.closureHours,
      mentions: s.roleMarketSnapshots.mentions,
      mustMentions: s.roleMarketSnapshots.mustMentions,
    })
    .from(s.roleMarketSnapshots)
    .innerJoin(s.skills, eq(s.skills.id, s.roleMarketSnapshots.skillId))
    .where(
      and(
        eq(s.roleMarketSnapshots.role, role),
        eq(s.roleMarketSnapshots.weekStart, latest.weekStart),
      ),
    );
  return {
    weekStart: latest.weekStart,
    rows: rows.map((r) => ({ ...r, weightedDemand: r.mentions + r.mustMentions })),
  };
}

export async function buildLearningPlan(
  db: Db,
  options: { userId: string; weekStart?: string },
): Promise<PlanBuildResult> {
  const { userId } = options;

  // Pocas ofertas propias y un rol válido: la demanda del rol es mejor señal que la de tres avisos
  let fromRole: { weekStart: string; rows: DemandRow[] } | null = null;
  const [profile] = await db
    .select({ targetRole: s.profiles.targetRole })
    .from(s.profiles)
    .where(eq(s.profiles.userId, userId))
    .limit(1);
  const targetRole = profile?.targetRole;
  if (isRoleKey(targetRole)) {
    const [own] = await db
      .select({ n: sql<number>`count(distinct ${s.jobSkills.jobId})::int` })
      .from(s.jobSkills)
      .innerJoin(s.jobs, eq(s.jobs.id, s.jobSkills.jobId))
      .where(eq(s.jobs.userId, userId));
    if ((own?.n ?? 0) < MIN_OWN_JOBS_FOR_PLAN) {
      const candidate = await loadRoleDemand(db, targetRole);
      if (candidate?.rows.length) fromRole = candidate;
    }
  }
  const demandSource: "usuario" | "rol" = fromRole ? "rol" : "usuario";

  let weekStart: string;
  let snapshot: DemandRow[];
  if (fromRole) {
    weekStart = fromRole.weekStart;
    snapshot = fromRole.rows;
  } else {
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
    if (!latest) {
      return { weekStart: null, rows: [], inserted: 0, updated: 0, removed: 0, demandSource };
    }
    weekStart = latest.weekStart;
    snapshot = await db
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
  }

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

  return { weekStart, rows, inserted, updated, removed, demandSource };
}
