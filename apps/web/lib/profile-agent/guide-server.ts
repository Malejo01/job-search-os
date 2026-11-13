import { schema as s } from "@job-search-os/db";
import {
  BETA_LAUNCH_ROLE_KEYS,
  GUIDE_STEP_COPY,
  applyGuideCriteria,
  guideDemandFromMarket,
  guideProfilePatch,
  guideReinforcePriority,
  guideRolesToSave,
  isRoleKey,
  sameCriteriaRules,
  toRoleKey,
  type AlertLanguage,
  type GuideDemand,
  type GuideStep,
  type ProfileGuideAnswers,
  type ProfileGuideCard,
  type RoleKey,
} from "@job-search-os/pipeline";
import { and, eq } from "drizzle-orm";
import { careerLabel, getCareerMarket } from "../career-market";
import { getActiveCriteria, saveCriteria } from "../criteria";
import { withUser } from "../db";
import { invalidateUserInsights } from "../insights-cache";
import { getTargetRolesLimit, isOnboardingComplete, setTargetRoles } from "../onboarding";

/**
 * Parte de servidor de la guía de búsqueda (ADR-034, R10-4). Sin modelo. Todo con `withUser` (RLS). La guía
 * escribe solo lo que la persona confirma con el clic y, antes de completar el onboarding, no escribe criterios
 * ni país (quedan en el estado del navegador y precargan el formulario, ADR §9). Las skills a reforzar salen
 * del mercado de la carrera (`getCareerMarket`, solo avisos públicos del pool), nunca de un modelo.
 */

export type GuideContext = {
  complete: boolean;
  language: AlertLanguage;
  /** Puestos y país del perfil, para precargar los pasos. */
  profileRoles: RoleKey[];
  profileCountry: string | null;
  levels: Record<string, number>;
};

export async function loadGuideContext(userId: string): Promise<GuideContext> {
  const complete = await isOnboardingComplete(userId);
  return withUser(userId, async (tx) => {
    const [p] = await tx
      .select({
        targetRoles: s.profiles.targetRoles,
        country: s.profiles.locationCountry,
        jobLanguages: s.profiles.jobLanguages,
      })
      .from(s.profiles)
      .where(eq(s.profiles.userId, userId))
      .limit(1);
    const langs = p?.jobLanguages ?? [];
    const es = langs.includes("es");
    const en = langs.includes("en");
    const levels = await tx
      .select({ slug: s.skills.slug, level: s.skillLevels.level })
      .from(s.skillLevels)
      .innerJoin(s.skills, eq(s.skills.id, s.skillLevels.skillId))
      .where(eq(s.skillLevels.userId, userId));
    const roles: RoleKey[] = [];
    for (const r of p?.targetRoles ?? []) {
      const k = toRoleKey(r);
      if (k && !roles.includes(k)) roles.push(k);
    }
    return {
      complete,
      language: es && !en ? "es" : en && !es ? "en" : "both",
      profileRoles: roles,
      // `XX` es el marcador del alta por invitación: no es un país elegido
      profileCountry: p?.country && p.country !== "XX" ? p.country : null,
      levels: Object.fromEntries(levels.map((l) => [l.slug, l.level])),
    };
  });
}

/** Lo que piden las ofertas públicas del pool de la carrera (caché de 30 min, sin usuarios). `null` si falla. */
export async function loadGuideDemand(role: RoleKey | null): Promise<GuideDemand | null> {
  if (role === null) return null;
  try {
    return guideDemandFromMarket(await getCareerMarket(role));
  } catch {
    return null;
  }
}

/** Opciones del paso de puestos: sugeridos por la lectura, los del perfil y las carreras de la beta. */
export function roleOptions(
  profileRoles: readonly RoleKey[],
  suggested: readonly string[],
): { value: string; label: string }[] {
  const keys = new Set<RoleKey>();
  for (const k of [...suggested.filter(isRoleKey), ...profileRoles, ...BETA_LAUNCH_ROLE_KEYS]) {
    keys.add(k);
  }
  return [...keys].map((value) => ({ value, label: careerLabel(value) }));
}

/** Etiquetas de los puestos de las respuestas, para mostrar las tarjetas con el nombre y nunca la clave. */
export function roleLabels(roles: readonly string[]): Record<string, string> {
  return Object.fromEntries(roles.filter(isRoleKey).map((k) => [k, careerLabel(k)]));
}

export type GuideStepView = {
  step: GuideStep;
  title: string;
  question: string;
  help: string;
};

export const stepView = (step: GuideStep): GuideStepView => ({ step, ...GUIDE_STEP_COPY[step] });

export function primaryRole(
  answers: ProfileGuideAnswers,
  profileRoles: readonly RoleKey[],
): RoleKey | null {
  const first = answers.roles?.[0];
  return (first && isRoleKey(first) ? first : null) ?? profileRoles[0] ?? null;
}

export type SaveGuideResult =
  | { ok: true; saved: boolean; deferred?: boolean }
  | { ok: false; reason: "not_found" | "invalid" | "limit"; field?: string };

/** Aplica una tarjeta confirmada. La tarjeta ya se validó y filtró en la ruta. */
export async function saveGuideCard(
  userId: string,
  card: ProfileGuideCard,
  complete: boolean,
): Promise<SaveGuideResult> {
  switch (card.kind) {
    case "roles": {
      const limit = await getTargetRolesLimit(userId);
      const roles = guideRolesToSave(card, limit);
      if (!roles.ok) return { ok: false, reason: "limit", field: roles.error };
      const r = await setTargetRoles(userId, roles.value);
      if (!r.saved) return { ok: false, reason: "not_found" };
      invalidateUserInsights(userId);
      return { ok: true, saved: true };
    }
    case "criteria": {
      // Antes de completar el onboarding no se escriben criterios ni país: precarga el formulario (ADR §9)
      if (!complete) return { ok: true, saved: false, deferred: true };
      const active = await getActiveCriteria(userId);
      if (!active) return { ok: false, reason: "not_found" };
      const rules = applyGuideCriteria(active.rules, card);
      if (!rules.ok) return { ok: false, reason: "invalid", field: rules.error };
      // Si las reglas no cambian no se crea una versión nueva (no-op)
      if (!sameCriteriaRules(active.rules, rules.value)) {
        const saved = await saveCriteria(userId, rules.value, active.version);
        if (!saved.ok) return { ok: false, reason: "invalid", field: "conflict" };
      }
      const patch = guideProfilePatch(card);
      if (Object.keys(patch).length > 0) {
        await withUser(userId, (tx) =>
          tx
            .update(s.profiles)
            .set({ ...patch, updatedAt: new Date() })
            .where(eq(s.profiles.userId, userId)),
        );
      }
      invalidateUserInsights(userId);
      return { ok: true, saved: true };
    }
    case "alert_keywords":
      // Es una guía para crear la alerta en el portal: no hay nada que guardar
      return { ok: true, saved: false };
    case "reinforce":
      return withUser(userId, async (tx): Promise<SaveGuideResult> => {
        // El `slug` tiene que ser de la taxonomía: uno desconocido se descarta (O6)
        const [skill] = await tx
          .select({ id: s.skills.id, closureHours: s.skills.closureHours })
          .from(s.skills)
          .where(eq(s.skills.slug, card.slug))
          .limit(1);
        if (!skill) return { ok: false, reason: "not_found" };
        const [existing] = await tx
          .select({ id: s.learningPlanItems.id })
          .from(s.learningPlanItems)
          .where(
            and(eq(s.learningPlanItems.userId, userId), eq(s.learningPlanItems.skillId, skill.id)),
          )
          .limit(1);
        if (existing) return { ok: true, saved: false };
        const [mine] = await tx
          .select({ level: s.skillLevels.level })
          .from(s.skillLevels)
          .where(and(eq(s.skillLevels.userId, userId), eq(s.skillLevels.skillId, skill.id)))
          .limit(1);
        await tx.insert(s.learningPlanItems).values({
          userId,
          skillId: skill.id,
          priority: guideReinforcePriority(card, mine?.level ?? null, skill.closureHours),
          status: "pendiente",
        });
        return { ok: true, saved: true };
      });
  }
}
