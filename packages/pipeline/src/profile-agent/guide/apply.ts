/**
 * De una tarjeta confirmada de la guía a lo que se escribe (ADR-034 §2 y §9, R10-4). Puro: devuelve los
 * valores ya validados con las mismas funciones que Ajustes (`parseTargetRoles`, `parseCriteriaForm`); la app
 * los escribe con `withUser` (RLS). Antes de completar el onboarding los criterios y el país no se escriben:
 * `guidePrefillFromAnswers` arma lo que precarga el formulario, que es el único que los guarda.
 */
import type { CriteriaRules } from "../../criteria";
import { criteriaFormDefaults, parseCriteriaForm, withCriteriaDefaults } from "../../criteria-form";
import { err, ok, type Result } from "../../result";
import { isRemoteOnly } from "../../onboarding";
import { easeFromClosureHours } from "../../skills/plan";
import { parseTargetRoles } from "../../skills/target-roles";
import type { RoleKey } from "../../skills/self-assessment";
import type { ProfileGuideAnswers, ProfileGuideCard } from "../schemas";

type Card<K extends ProfileGuideCard["kind"]> = Extract<ProfileGuideCard, { kind: K }>;

/** Puestos de la tarjeta con el tope del plan; falla en vez de recortar en silencio. */
export function guideRolesToSave(
  card: Card<"roles">,
  limit: number,
): Result<RoleKey[], "targetRoles"> {
  const parsed = parseTargetRoles(card.roles, limit);
  return parsed.ok ? ok(parsed.roles) : err("targetRoles");
}

/**
 * Reglas de criterios con lo que eligió la persona sobre las vigentes. Solo cambia lo que la tarjeta trae:
 * años máximos, mínimo mensual y palabras a evitar (se suman a `title_blocklist`, sin repetir). Pasa por
 * `parseCriteriaForm`: los límites son los del formulario de Ajustes.
 */
export function applyGuideCriteria(
  stored: CriteriaRules | null,
  card: Card<"criteria">,
): Result<CriteriaRules, string> {
  const current = withCriteriaDefaults(stored);
  const raw: Record<string, string | string[]> = { ...criteriaFormDefaults(current) };
  if (card.maxYearsHard !== null) raw.max_years_hard = String(card.maxYearsHard);
  if (card.salaryFloorUsdMonthly !== null) {
    raw.salary_floor_usd_monthly = String(card.salaryFloorUsdMonthly);
  }
  if (card.titleBlocklistAdd.length > 0) {
    raw.title_blocklist = [...current.title_blocklist, ...card.titleBlocklistAdd].join("\n");
  }
  const parsed = parseCriteriaForm(raw, current);
  return parsed.ok ? ok(parsed.rules) : err(parsed.field);
}

/** Lo que la tarjeta cambia en el perfil (modalidades, país y mínimo salarial), solo lo elegido. */
export type GuideProfilePatch = {
  acceptedModalities?: string[];
  remoteOnly?: boolean;
  locationCountry?: string;
  salaryFloorUsd?: number;
};

export function guideProfilePatch(card: Card<"criteria">): GuideProfilePatch {
  const patch: GuideProfilePatch = {};
  if (card.modalities !== null) {
    patch.acceptedModalities = [...card.modalities];
    patch.remoteOnly = isRemoteOnly(card.modalities);
  }
  if (card.country !== null) patch.locationCountry = card.country;
  if (card.salaryFloorUsdMonthly !== null) patch.salaryFloorUsd = card.salaryFloorUsdMonthly;
  return patch;
}

/**
 * Lo que precarga el formulario del onboarding cuando todavía no se puede escribir (ADR-034 §9). Es el mismo
 * recorte de la tarjeta, sin tocar la base.
 */
export function guidePrefillFromAnswers(answers: ProfileGuideAnswers): {
  targetRoles: string[];
  acceptedModalities: string[] | null;
  country: string | null;
  salaryFloorUsd: number | null;
  maxYearsHard: number | null;
  titleBlocklistAdd: string[];
} {
  return {
    targetRoles: answers.roles ?? [],
    acceptedModalities:
      answers.modalities && answers.modalities.length > 0 ? [...answers.modalities] : null,
    country: answers.country ?? null,
    salaryFloorUsd: answers.salaryFloorUsdMonthly ?? null,
    maxYearsHard: answers.maxYearsHard ?? null,
    titleBlocklistAdd: answers.avoid ?? [],
  };
}

/**
 * Prioridad de una skill a reforzar en el plan: la misma fórmula del plan (demanda × (1 − nivel/3) ×
 * facilidad) con la demanda como fracción de ofertas que la piden, sobre 10. Sale de datos.
 */
export function guideReinforcePriority(
  card: Card<"reinforce">,
  level: number | null,
  closureHours: number | null,
): number {
  const share = card.evidence.offersAsking / card.evidence.poolSize;
  const lvl = Math.min(3, Math.max(0, level ?? 0));
  return Math.round(share * 10 * (1 - lvl / 3) * easeFromClosureHours(closureHours) * 100) / 100;
}
