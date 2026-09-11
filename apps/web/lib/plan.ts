import { schema as s } from "@job-search-os/db";
import { PLAN_STATUSES, type PlanStatus } from "@job-search-os/pipeline";
import { and, desc, eq } from "drizzle-orm";
import { withUser } from "./db";

/** Plan de formación (JS-034): lectura y cambio de estado con el rol de la app (RLS). */
export type PlanItemView = {
  id: string;
  slug: string;
  name: string;
  category: string;
  level: number | null;
  closureHours: number | null;
  hoursRemaining: number | null;
  priority: number;
  status: PlanStatus;
  startedAt: string | null;
  closedAt: string | null;
  resource: {
    title: string;
    provider: string;
    url: string;
    hours: number | null;
    targetLevel: number;
  } | null;
};

export async function getPlan(userId: string): Promise<PlanItemView[]> {
  return withUser(userId, async (tx) => {
    const rows = await tx
      .select({
        id: s.learningPlanItems.id,
        slug: s.skills.slug,
        name: s.skills.name,
        category: s.skills.category,
        closureHours: s.skills.closureHours,
        level: s.skillLevels.level,
        priority: s.learningPlanItems.priority,
        status: s.learningPlanItems.status,
        startedAt: s.learningPlanItems.startedAt,
        closedAt: s.learningPlanItems.closedAt,
        resTitle: s.learningResources.title,
        resProvider: s.learningResources.provider,
        resUrl: s.learningResources.url,
        resHours: s.learningResources.hours,
        resTarget: s.learningResources.targetLevel,
      })
      .from(s.learningPlanItems)
      .innerJoin(s.skills, eq(s.skills.id, s.learningPlanItems.skillId))
      .leftJoin(
        s.skillLevels,
        and(
          eq(s.skillLevels.skillId, s.learningPlanItems.skillId),
          eq(s.skillLevels.userId, userId),
        ),
      )
      .leftJoin(s.learningResources, eq(s.learningResources.id, s.learningPlanItems.resourceId))
      .orderBy(desc(s.learningPlanItems.priority));
    return rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      name: r.name,
      category: r.category,
      level: r.level,
      closureHours: r.closureHours,
      hoursRemaining:
        r.closureHours === null
          ? null
          : Math.round(r.closureHours * (1 - Math.min(3, r.level ?? 0) / 3)),
      priority: r.priority,
      status: (PLAN_STATUSES as readonly string[]).includes(r.status)
        ? (r.status as PlanStatus)
        : "pendiente",
      startedAt: r.startedAt,
      closedAt: r.closedAt,
      resource: r.resTitle
        ? {
            title: r.resTitle,
            provider: r.resProvider ?? "",
            url: r.resUrl ?? "",
            hours: r.resHours,
            targetLevel: r.resTarget ?? 0,
          }
        : null,
    }));
  });
}

/** pendiente → en_curso (started_at) → cerrada (closed_at); también se puede volver a pendiente. */
export async function setPlanStatus(
  userId: string,
  itemId: string,
  status: PlanStatus,
): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  await withUser(userId, async (tx) => {
    const updated = await tx
      .update(s.learningPlanItems)
      .set({
        status,
        ...(status === "en_curso" ? { startedAt: today, closedAt: null } : {}),
        ...(status === "cerrada" ? { closedAt: today } : {}),
        ...(status === "pendiente" ? { startedAt: null, closedAt: null } : {}),
      })
      .where(and(eq(s.learningPlanItems.id, itemId), eq(s.learningPlanItems.userId, userId)))
      .returning({ id: s.learningPlanItems.id });
    if (!updated.length) throw new Error("ítem del plan inexistente");
  });
}
