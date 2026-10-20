import { schema as s } from "@job-search-os/db";
import {
  criteriaFromOnboarding,
  isProfileComplete,
  isRoleKey,
  type OnboardingInput,
  targetRolesLimit,
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

/** Claves conocidas y sin repetir, en el orden guardado: la base no valida, el código sí. */
function knownRoles(values: readonly unknown[] | null | undefined): RoleKey[] {
  const out: RoleKey[] = [];
  for (const v of values ?? []) if (isRoleKey(v) && !out.includes(v)) out.push(v);
  return out;
}

function sameRoleSet(a: readonly RoleKey[], b: readonly RoleKey[]): boolean {
  return a.length === b.length && a.every((r) => b.includes(r));
}

/**
 * Puestos que la persona dijo que busca (`profiles.target_roles`, ronda 45). El primero es el
 * principal. Vacío si todavía no eligió. Los valores que no son una clave conocida se ignoran.
 */
export async function getTargetRoles(userId: string): Promise<RoleKey[]> {
  return withUser(userId, async (tx) => {
    const [row] = await tx
      .select({ targetRoles: s.profiles.targetRoles })
      .from(s.profiles)
      .where(eq(s.profiles.userId, userId))
      .limit(1);
    return knownRoles(row?.targetRoles);
  });
}

/**
 * Tope de puestos de la persona: `max_target_roles` del perfil si lo tiene; si no, el del entorno
 * (`TARGET_ROLES_FREE_LIMIT`, 2 por defecto). La regla vive en el pipeline.
 */
export async function getTargetRolesLimit(userId: string): Promise<number> {
  return withUser(userId, async (tx) => {
    const [row] = await tx
      .select({ max: s.profiles.maxTargetRoles })
      .from(s.profiles)
      .where(eq(s.profiles.userId, userId))
      .limit(1);
    return targetRolesLimit(process.env, row?.max ?? null);
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
 * Cambia los puestos (Ajustes). Guarda la lista y el principal (`target_role` = el primero) en la
 * misma escritura. Exige al menos una clave y solo claves conocidas, sin repetir; el tope por plan
 * lo valida quien llama con `parseTargetRoles`. `changed` es verdadero si el conjunto anterior era
 * distinto; se lee en la misma transacción que el cambio.
 */
export async function setTargetRoles(
  userId: string,
  roles: unknown,
): Promise<{ saved: boolean; changed: boolean }> {
  if (!Array.isArray(roles) || roles.length === 0) return { saved: false, changed: false };
  const next = knownRoles(roles);
  if (next.length !== new Set(roles).size) return { saved: false, changed: false };
  return withUser(userId, async (tx) => {
    const [before] = await tx
      .select({ targetRoles: s.profiles.targetRoles })
      .from(s.profiles)
      .where(eq(s.profiles.userId, userId))
      .limit(1);
    if (!before) return { saved: false, changed: false };
    const previous = knownRoles(before.targetRoles);
    await tx
      .update(s.profiles)
      .set({ targetRoles: next, targetRole: next[0], updatedAt: new Date() })
      .where(eq(s.profiles.userId, userId));
    return { saved: true, changed: !sameRoleSet(previous, next) };
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
      .select({ targetRoles: s.profiles.targetRoles })
      .from(s.profiles)
      .where(eq(s.profiles.userId, userId))
      .limit(1);
    const previousRoles = knownRoles(before?.targetRoles);
    const updated = await tx
      .update(s.profiles)
      .set({
        targetRoles: input.targetRoles,
        // El principal es el primero de la lista y se escribe siempre junto con ella
        targetRole: input.targetRoles[0] ?? null,
        locationCountry: input.locationCountry,
        locationCity: input.locationCity,
        // remote_only se mantiene en sincronía: lo leen el MCP, los borradores y el prompt
        remoteOnly: input.remoteOnly,
        acceptedModalities: input.acceptedModalities,
        jobLanguages: input.jobLanguages,
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
    return { saved: true, roleChanged: !sameRoleSet(previousRoles, input.targetRoles) };
  });
}
