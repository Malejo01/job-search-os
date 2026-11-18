import { schema as s } from "@job-search-os/db";
import {
  isPlanOverride,
  planAccess,
  planDef,
  type PlanAccess,
  type PlanDef,
  type PlanOverride,
} from "@job-search-os/pipeline";
import { eq } from "drizzle-orm";
import { withUser } from "./db";

export type UserPlan = {
  /** El plan que rige hoy (uno vencido o desconocido rige como gratis). */
  plan: PlanDef;
  /** Hasta cuándo dura, si tiene fecha; null si no vence. En un plan vencido, la fecha en que venció. */
  until: Date | null;
  /** El plan guardado venció y por eso rige el gratis. */
  expired: boolean;
  /** Estado de la vigencia (C3-1): activo, por vencer, vencido, becado… Sale de `planAccess`. */
  access: PlanAccess;
};

/**
 * Marca de precio especial de la persona (ADR-040), leída con RLS desde su propia fila: solo ve la suya y
 * nunca puede escribirla. `null` si no tiene (o si la base guarda un valor desconocido: falla hacia
 * «sin marca» solo acá; el CHECK de la tabla ya impide valores fuera de lista).
 */
export async function getPlanOverride(userId: string): Promise<PlanOverride | null> {
  const [row] = await withUser(userId, (tx) =>
    tx
      .select({ override: s.planOverrides.override })
      .from(s.planOverrides)
      .where(eq(s.planOverrides.userId, userId))
      .limit(1),
  );
  return isPlanOverride(row?.override) ? row.override : null;
}

/** Plan de la beta paga de la persona (C-11b), leído con RLS desde su propio perfil. */
export async function getUserPlan(userId: string, now: Date = new Date()): Promise<UserPlan> {
  const [row] = await withUser(userId, (tx) =>
    tx
      .select({
        plan: s.profiles.plan,
        planUntil: s.profiles.planUntil,
        planSource: s.profiles.planSource,
      })
      .from(s.profiles)
      .where(eq(s.profiles.userId, userId))
      .limit(1),
  );
  const access = planAccess({
    plan: row?.plan,
    planUntil: row?.planUntil ?? null,
    planSource: row?.planSource,
    now,
  });
  return {
    plan: planDef(access.plan),
    until: access.until,
    expired: access.status === "vencido",
    access,
  };
}
