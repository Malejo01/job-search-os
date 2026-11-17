import type { SkillDemand } from "./market";
import { ROLE_GROUPS, ROLE_KEYS, type RoleKey, type RoleSkillsMap } from "./self-assessment";

/**
 * Plan de formación determinista (JS-034): prioridad = demanda_ponderada × (1 − nivel/3) × facilidad.
 * `facilidad` sale de closure_hours de la taxonomía (horas para llegar a nivel 2 desde 0):
 * 16 h o menos → 1; 40 h → 0,4; 80 h → 0,2; sin dato → 0,5. Así una skill muy pedida pero
 * carísima de cerrar (fine-tuning, 80 h) no le gana a una igual de pedida y barata (CI/CD, 16 h).
 */
export const EASE_REFERENCE_HOURS = 16;

export function easeFromClosureHours(closureHours: number | null | undefined): number {
  if (closureHours === null || closureHours === undefined) return 0.5;
  if (closureHours <= 0) return 1;
  return Math.min(1, Math.max(0.1, EASE_REFERENCE_HOURS / closureHours));
}

export function planPriority(
  weightedDemand: number,
  level: number | null,
  closureHours: number | null | undefined,
): number {
  const lvl = Math.min(3, Math.max(0, level ?? 0));
  return (
    Math.round(weightedDemand * (1 - lvl / 3) * easeFromClosureHours(closureHours) * 100) / 100
  );
}

export type PlanSkillInput = SkillDemand & {
  level: number | null;
  closureHours: number | null;
};

export type PlanRow = PlanSkillInput & {
  priority: number;
  ease: number;
  /** Horas estimadas que faltan: closure_hours × (1 − nivel/3), redondeado. */
  hoursRemaining: number | null;
};

/** Skills con algo que cerrar (nivel < 3 y demanda > 0), ordenadas por prioridad desc. */
export function buildPlan(skills: readonly PlanSkillInput[]): PlanRow[] {
  return skills
    .filter((s) => (s.level ?? 0) < 3 && s.weightedDemand > 0)
    .map((s) => ({
      ...s,
      ease: easeFromClosureHours(s.closureHours),
      priority: planPriority(s.weightedDemand, s.level, s.closureHours),
      hoursRemaining:
        s.closureHours === null
          ? null
          : Math.round(s.closureHours * (1 - Math.min(3, s.level ?? 0) / 3)),
    }))
    .sort((a, b) => b.priority - a.priority || a.slug.localeCompare(b.slug));
}

/** Nivel al que «aprender» lleva una skill (el mismo del simulador) y tolerancia en horas. */
const RESOURCE_TARGET_LEVEL = 2;
const RESOURCE_MAX_HOURS_RATIO = 2;

/**
 * Mejor recurso del catálogo para una skill (121 §7). De los que suben el nivel actual, el de
 * menos horas (los sin dato al final, y a igualdad, el orden de entrada). Si ese lleva solo a nivel
 * 1 y hay uno que lleva a nivel 2 o más por como mucho el doble de horas, gana ese. Sin horas
 * conocidas no se compara.
 */
export function pickLearningResource<T extends { targetLevel: number; hours: number | null }>(
  resources: readonly T[],
  level: number | null,
): T | null {
  const current = level ?? 0;
  const byHours = resources
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => r.targetLevel > current)
    .sort(
      (a, b) =>
        (a.r.hours ?? Number.POSITIVE_INFINITY) - (b.r.hours ?? Number.POSITIVE_INFINITY) ||
        a.i - b.i,
    )
    .map(({ r }) => r);
  const cheapest = byHours[0];
  if (!cheapest) return null;
  if (cheapest.targetLevel >= RESOURCE_TARGET_LEVEL || cheapest.hours === null) return cheapest;
  const limit = cheapest.hours * RESOURCE_MAX_HOURS_RATIO;
  const deeper = byHours.find(
    (r) => r.targetLevel >= RESOURCE_TARGET_LEVEL && r.hours !== null && r.hours <= limit,
  );
  return deeper ?? cheapest;
}

/**
 * Plan sin skills de otra familia (R11-9). Una persona de Contaduría no tiene que ver «IAM» ni
 * «Growth» en su plan porque dos avisos las nombren. Familia de una skill = los grupos de carrera
 * (`ROLE_GROUPS`) en cuyos `role_skills` aparece. Para la carrera de la persona:
 * - propia: la skill está en el `role_skills` de su carrera (en tecnología y producto, en el de
 *   cualquiera del grupo);
 * - transversal: está en `role_skills` de 3 o más grupos (Excel, inglés, Jira...);
 * - sin dueño: no está en ningún `role_skills`. Si su categoría es de tecnología (`ai_core`,
 *   `cloud`...) y la carrera no es de tecnología, es de otra familia; si no, se deja pasar.
 * Cualquier otra es de otra familia y entra al plan solo si la demanda de la carrera la justifica:
 * al menos `OFF_FAMILY_MIN_MENTIONS` avisos Y al menos `OFF_FAMILY_MIN_SHARE` de las menciones de
 * la skill más pedida del mismo plan. El umbral es el mismo para las 8 carreras de la beta.
 */
export const OFF_FAMILY_MIN_MENTIONS = 5;
export const OFF_FAMILY_MIN_SHARE = 0.25;
const TRANSVERSAL_MIN_GROUPS = 3;
const COHESIVE_GROUPS: readonly string[] = ["Tecnología", "Producto y proyectos"];

export function planFamilies(roleSkills: RoleSkillsMap): {
  /** Skills de las carreras del mismo grupo que `role`. */
  own: (role: RoleKey) => Set<string>;
  transversal: Set<string>;
  /** Skills que figuran en algún `role_skills`. */
  owned: Set<string>;
} {
  const groupOf = (role: RoleKey) => ROLE_GROUPS.find((g) => g.roles.includes(role));
  // Solo en tecnología y producto las carreras del grupo comparten familia; en «Derecho, contabilidad
  // y gestión» o «Comunicación» cada carrera es la suya (Contaduría no hereda IP de Abogacía).
  const siblings = (role: RoleKey): readonly RoleKey[] => {
    const group = groupOf(role);
    return group && COHESIVE_GROUPS.includes(group.label) ? group.roles : [role];
  };
  const groupsBySkill = new Map<string, Set<string>>();
  const owned = new Set<string>();
  for (const role of ROLE_KEYS) {
    const label = groupOf(role)?.label ?? role;
    for (const slug of roleSkills[role].skills) {
      owned.add(slug);
      groupsBySkill.set(slug, (groupsBySkill.get(slug) ?? new Set()).add(label));
    }
  }
  const transversal = new Set(
    [...groupsBySkill].filter(([, g]) => g.size >= TRANSVERSAL_MIN_GROUPS).map(([slug]) => slug),
  );
  return {
    own: (role) => new Set(siblings(role).flatMap((r) => roleSkills[r].skills)),
    transversal,
    owned,
  };
}

/** Categorías de `skills` que son de tecnología: una skill sin dueño con una de estas es de IT. */
const TECH_SKILL_CATEGORIES: readonly string[] = [
  "cloud",
  "infra",
  "testing",
  "ai_core",
  "datos",
  "framework",
  "llm_ops",
  "lenguaje",
];

export function filterPlanByCareer<T extends SkillDemand & { category?: string | null }>(
  rows: readonly T[],
  role: RoleKey,
  roleSkills: RoleSkillsMap,
): T[] {
  const families = planFamilies(roleSkills);
  const own = families.own(role);
  const isTechRole = ROLE_GROUPS.find((g) => g.roles.includes(role))?.label === "Tecnología";
  const maxMentions = rows.reduce((m, r) => Math.max(m, r.mentions), 0);
  const minMentions = Math.max(
    OFF_FAMILY_MIN_MENTIONS,
    Math.ceil(maxMentions * OFF_FAMILY_MIN_SHARE),
  );
  const offFamily = (r: T): boolean => {
    if (own.has(r.slug) || families.transversal.has(r.slug)) return false;
    if (families.owned.has(r.slug)) return true;
    // Sin dueño en `role_skills`: solo se sabe de quién es por la categoría (multimodal es de IT)
    return !isTechRole && TECH_SKILL_CATEGORIES.includes(r.category ?? "");
  };
  return rows.filter((r) => !offFamily(r) || r.mentions >= minMentions);
}

export const PLAN_STATUSES = ["pendiente", "en_curso", "cerrada"] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];
