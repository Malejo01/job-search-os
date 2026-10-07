import { schema as s } from "@job-search-os/db";
import {
  criteriaFromOnboarding,
  isProfileComplete,
  type OnboardingInput,
} from "@job-search-os/pipeline";
import { and, eq, sql } from "drizzle-orm";
import { withUser } from "./db";

/** Onboarding obligatorio (B2, JS-094): la regla de "completo" vive en packages/pipeline. */

/** ¿El perfil del usuario ya puede evaluar ofertas? Sin perfil o sin criterios activos, no. */
export async function isOnboardingComplete(userId: string): Promise<boolean> {
  return withUser(userId, async (tx) => {
    const [profile] = await tx
      .select({
        locationCountry: s.profiles.locationCountry,
        profileSummary: s.profiles.profileSummary,
      })
      .from(s.profiles)
      .where(eq(s.profiles.userId, userId))
      .limit(1);
    if (!profile) return false;
    const [active] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(s.evaluationCriteria)
      .where(and(eq(s.evaluationCriteria.userId, userId), eq(s.evaluationCriteria.active, true)));
    return isProfileComplete({ ...profile, activeCriteriaCount: active?.n ?? 0 });
  });
}

/**
 * Guarda el formulario: actualiza el perfil y, si el usuario no tiene criterios activos, crea
 * la versión siguiente (1 si no tenía ninguna) con las reglas por defecto. Todo en una transacción.
 * Devuelve false si el usuario no tiene fila de perfil (no se inventa una).
 */
export async function completeOnboarding(userId: string, input: OnboardingInput): Promise<boolean> {
  return withUser(userId, async (tx) => {
    const updated = await tx
      .update(s.profiles)
      .set({
        locationCountry: input.locationCountry,
        locationCity: input.locationCity,
        remoteOnly: input.remoteOnly,
        workAuth: input.workAuth,
        englishCefr: input.englishCefr,
        yearsTotal: input.yearsTotal,
        salaryFloorUsd: input.salaryFloorUsd,
        maxWeeklyHours: input.maxWeeklyHours ?? 40,
        profileSummary: input.profileSummary,
        updatedAt: new Date(),
      })
      .where(eq(s.profiles.userId, userId))
      .returning({ userId: s.profiles.userId });
    if (updated.length === 0) return false;

    const [crit] = await tx
      .select({
        active: sql<number>`count(*) filter (where ${s.evaluationCriteria.active})::int`,
        maxVersion: sql<number>`coalesce(max(${s.evaluationCriteria.version}), 0)::int`,
      })
      .from(s.evaluationCriteria)
      .where(eq(s.evaluationCriteria.userId, userId));
    if ((crit?.active ?? 0) === 0) {
      // Doble submit: el unique (user_id, version) deja pasar una sola fila; la otra no hace nada
      await tx
        .insert(s.evaluationCriteria)
        .values({
          userId,
          version: (crit?.maxVersion ?? 0) + 1,
          active: true,
          rules: criteriaFromOnboarding(input),
        })
        .onConflictDoNothing();
    }
    return true;
  });
}
