import type { SkillDemand } from "./market";

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

export const PLAN_STATUSES = ["pendiente", "en_curso", "cerrada"] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];
