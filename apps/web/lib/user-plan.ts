import { schema as s } from "@job-search-os/db";
import { effectivePlan, planDef, type PlanDef } from "@job-search-os/pipeline";
import { eq } from "drizzle-orm";
import { withUser } from "./db";

export type UserPlan = {
  /** El plan que rige hoy (uno vencido o desconocido rige como gratis). */
  plan: PlanDef;
  /** Hasta cuándo dura, si tiene fecha; null si no vence. */
  until: Date | null;
  /** El plan guardado venció y por eso rige el gratis. */
  expired: boolean;
};

/** Plan de la beta paga de la persona (C-11b), leído con RLS desde su propio perfil. */
export async function getUserPlan(userId: string, now: Date = new Date()): Promise<UserPlan> {
  const [row] = await withUser(userId, (tx) =>
    tx
      .select({ plan: s.profiles.plan, planUntil: s.profiles.planUntil })
      .from(s.profiles)
      .where(eq(s.profiles.userId, userId))
      .limit(1),
  );
  const key = effectivePlan(row?.plan, row?.planUntil ?? null, now);
  const expired = key === "gratis" && row !== undefined && row.plan !== "gratis";
  return { plan: planDef(key), until: key === "gratis" ? null : (row?.planUntil ?? null), expired };
}
