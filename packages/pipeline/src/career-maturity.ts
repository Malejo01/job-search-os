/**
 * Carrera «madura» o «en pulido» (C-13). Puro: recibe el resultado de cada regla y decide.
 *
 * Una carrera está madura cuando cumple las tres reglas del informe comercial: suficientes ofertas
 * por mes, la mayoría de los 👍/👎 son 👍, y suficientes personas activas que la siguen. Si falta
 * cualquiera, o una regla no se puede evaluar, queda «en pulido»: falla cerrado hacia lo prudente.
 *
 * Las reglas se evalúan en la base (`career_maturity_stats()`, rls/0009) y vuelven solo como sí/no:
 * la función la puede llamar cualquier sesión, y un booleano no deja reconstruir conteos chicos.
 * Los umbrales de acá son los mismos que están fijos en ese SQL: si cambian, cambian los dos.
 */

export const CAREER_MATURITY_THRESHOLDS = {
  /** Ofertas nuevas del pool en los últimos 30 días. */
  offersPerMonth: 100,
  /** Proporción de 👍 sobre 👍 + 👎 en las evaluaciones de la carrera (90 días). */
  thumbsUpRate: 0.6,
  /** Personas distintas que opinaron: con menos, la regla de 👍 no se evalúa. */
  thumbsMinPeople: 5,
  /** Personas activas en 30 días que siguen la carrera. */
  activeUsers: 10,
} as const;

export type CareerMaturityRules = {
  offersOk: boolean;
  /** null = menos personas que `thumbsMinPeople` opinaron: la regla no se puede evaluar. */
  thumbsOk: boolean | null;
  activeOk: boolean;
};

export type CareerMaturity = "madura" | "en_pulido";

export function careerMaturity(rules: CareerMaturityRules | null | undefined): CareerMaturity {
  if (!rules) return "en_pulido";
  return rules.offersOk && rules.thumbsOk === true && rules.activeOk ? "madura" : "en_pulido";
}

export const CAREER_MATURITY_LABEL: Record<CareerMaturity, string> = {
  madura: "Carrera madura",
  en_pulido: "En pulido: tu feedback la mejora",
};

/** El badge se muestra solo con `CAREER_MATURITY_BADGE=1`: espera la línea de la política de privacidad. */
export function careerMaturityBadgeEnabled(env: Record<string, string | undefined>): boolean {
  return env.CAREER_MATURITY_BADGE === "1";
}
