import { schema as s } from "@job-search-os/db";
import {
  criteriaFromOnboarding,
  isProfileComplete,
  isRoleKey,
  type OnboardingInput,
  type RoleKey,
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
 * Rol que la persona dijo que busca (`profiles.target_role`), o null si no eligió ("Otro o varios")
 * o si el valor guardado no es una clave conocida: la base no lo valida, el código sí.
 */
export async function getTargetRole(userId: string): Promise<RoleKey | null> {
  return withUser(userId, async (tx) => {
    const [row] = await tx
      .select({ targetRole: s.profiles.targetRole })
      .from(s.profiles)
      .where(eq(s.profiles.userId, userId))
      .limit(1);
    return isRoleKey(row?.targetRole) ? row.targetRole : null;
  });
}

/** ¿La persona ya recibió algún email (`inbound_emails`)? Con RLS: cuenta solo los suyos. */
export async function hasReceivedEmail(userId: string): Promise<boolean> {
  return withUser(userId, async (tx) => {
    const [row] = await tx
      .select({ id: s.inboundEmails.id })
      .from(s.inboundEmails)
      .where(eq(s.inboundEmails.userId, userId))
      .limit(1);
    return Boolean(row);
  });
}

/**
 * Cambia el rol objetivo (Mis skills y Ajustes). Acepta una clave de rol o null («Otro o varios»);
 * cualquier otro valor no se guarda. `changed` es verdadero si el valor anterior era distinto; se
 * lee en la misma transacción que el cambio.
 */
export async function setTargetRole(
  userId: string,
  role: unknown,
): Promise<{ saved: boolean; changed: boolean }> {
  if (role !== null && !isRoleKey(role)) return { saved: false, changed: false };
  return withUser(userId, async (tx) => {
    const [before] = await tx
      .select({ targetRole: s.profiles.targetRole })
      .from(s.profiles)
      .where(eq(s.profiles.userId, userId))
      .limit(1);
    if (!before) return { saved: false, changed: false };
    const previous = isRoleKey(before.targetRole) ? before.targetRole : null;
    await tx
      .update(s.profiles)
      .set({ targetRole: role, updatedAt: new Date() })
      .where(eq(s.profiles.userId, userId));
    return { saved: true, changed: previous !== role };
  });
}

/**
 * Guarda el formulario: actualiza el perfil y, si el usuario no tiene criterios activos, crea
 * la versión siguiente (1 si no tenía ninguna) con las reglas por defecto. Todo en una transacción.
 * Devuelve `saved: false` si el usuario no tiene fila de perfil (no se inventa una); `roleChanged`
 * dice si el puesto es distinto del que había (un reenvío del paso 1 con otro puesto).
 */
export async function completeOnboarding(
  userId: string,
  input: OnboardingInput,
): Promise<{ saved: boolean; roleChanged: boolean }> {
  return withUser(userId, async (tx) => {
    const [before] = await tx
      .select({ targetRole: s.profiles.targetRole })
      .from(s.profiles)
      .where(eq(s.profiles.userId, userId))
      .limit(1);
    const previousRole = isRoleKey(before?.targetRole) ? before.targetRole : null;
    const updated = await tx
      .update(s.profiles)
      .set({
        targetRole: input.targetRole,
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
    if (updated.length === 0) return { saved: false, roleChanged: false };

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
    return { saved: true, roleChanged: previousRole !== (input.targetRole ?? null) };
  });
}
