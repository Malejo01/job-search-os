/**
 * Página de planes v2 (R15-1), detrás de `PRICING_V2`. Puro: recibe el entorno ya leído y los planes
 * de `plans.ts`; no define ningún monto. Todo lo que muestra sale de `PLANS`: el precio, la duración y
 * los topes. Nada de urgencia (sin contadores, sin cupos, sin precios tachados) y ninguna afirmación que
 * no se pueda comprobar: por eso la etiqueta es «Recomendado» y no «Más elegido» (no hay datos de
 * elección que la respalden).
 */
import { pricingEnabled, type PlanDef, type PlanLimits } from "./plans";

/** La v2 solo rige con los precios encendidos: `PRICING_V2=1` además de `PRICING_ENABLED=1`. */
export function pricingV2Enabled(env: Record<string, string | undefined>): boolean {
  return pricingEnabled(env) && env.PRICING_V2 === "1";
}

/**
 * Qué planes se muestran y en qué orden. Sin `PRICING_V2` devuelve exactamente la lista de siempre, en su
 * orden y sin plan recomendado: la página queda como hoy (lo verifica un test).
 */
export function plansView(
  env: Record<string, string | undefined>,
  listed: readonly PlanDef[],
  betaKey: string,
): { v2: boolean; plans: PlanDef[]; recommendedKey: string | null } {
  if (!pricingV2Enabled(env)) return { v2: false, plans: [...listed], recommendedKey: null };
  const plans = orderPlansForV2(listed);
  return { v2: true, plans, recommendedKey: recommendedPlanKey(plans, betaKey) };
}

/** Etiqueta del plan que se sugiere. Es una recomendación del producto, no un dato de uso. */
export const RECOMMENDED_LABEL = "Recomendado";

/**
 * Precio por día en pesos enteros: monto mensual ÷ días que dura cada pago, **redondeado hacia arriba**
 * (nunca hacia abajo: un redondeo a la baja haría ver el plan más barato de lo que es). Null si el plan
 * no se cobra por período (gratis, pago único) o no tiene precio ni duración.
 */
export function pricePerDayArs(plan: PlanDef): number | null {
  if (plan.billing !== "mensual") return null;
  if (plan.priceArs === null || plan.priceArs <= 0) return null;
  if (plan.durationDays === null || plan.durationDays <= 0) return null;
  // Techo con enteros: sin errores de coma flotante
  return Math.floor((plan.priceArs + plan.durationDays - 1) / plan.durationDays);
}

/** «$ 667 por día», o null si el plan no tiene precio por día. */
export function pricePerDayLabel(plan: PlanDef): string | null {
  const perDay = pricePerDayArs(plan);
  return perDay === null ? null : `$ ${perDay.toLocaleString("es-AR")} por día`;
}

/** De dónde sale la cuenta, para que se pueda verificar: «$ 20.000 por mes ÷ 30 días, redondeado hacia arriba». */
export function pricePerDayNote(plan: PlanDef): string | null {
  if (pricePerDayArs(plan) === null) return null;
  return `$ ${plan.priceArs!.toLocaleString("es-AR")} por mes ÷ ${plan.durationDays} días, redondeado hacia arriba al peso`;
}

/** Orden de la v2: el plan más completo primero (el pago antes que el gratis). Estable entre iguales. */
export function orderPlansForV2(plans: readonly PlanDef[]): PlanDef[] {
  return plans
    .map((plan, index) => ({ plan, index }))
    .sort((a, b) => {
      const byEvals = b.plan.limits.evaluationsPerDay - a.plan.limits.evaluationsPerDay;
      return byEvals !== 0 ? byEvals : a.index - b.index;
    })
    .map((x) => x.plan);
}

/**
 * Clave del plan «Recomendado»: el plan de la beta, solo si es pago, tiene precio y hay otro plan con quien
 * compararlo. Con un único plan listado no se recomienda nada.
 */
export function recommendedPlanKey(plans: readonly PlanDef[], betaKey: string): string | null {
  if (plans.length < 2) return null;
  const beta = plans.find((p) => p.key === betaKey);
  return beta && beta.billing !== "gratis" && beta.priceArs !== null ? beta.key : null;
}

type Enabled = { cv: boolean; assistant: boolean };

const n = (v: number, one: string, many: string) => `${v} ${v === 1 ? one : many}`;

/**
 * Qué te da el plan, dicho como resultado. Cada frase corresponde a un tope que el plan tiene hoy en
 * `PlanLimits`; no promete entrevistas ni trabajo. CV y asistente solo si la función está encendida.
 */
export function planBenefits(limits: PlanLimits, enabled: Enabled): string[] {
  return [
    `Hasta ${n(limits.evaluationsPerDay, "oferta leída", "ofertas leídas")} por día contra tu perfil, con el porqué de cada una`,
    `Buscás en hasta ${n(limits.targetRoles, "carrera", "carreras")} a la vez`,
    ...(enabled.cv
      ? [
          `Hasta ${n(limits.cvReadsPerMonth, "lectura", "lecturas")} de CV por mes para armar tu perfil`,
        ]
      : []),
    ...(enabled.assistant
      ? [`Hasta ${n(limits.conversationsPerMonth, "charla", "charlas")} con el asistente por mes`]
      : []),
  ];
}

/**
 * Lo que este plan no incluye comparado con el más completo (`reference`). Solo topes que de verdad son
 * menores; un plan sin diferencias devuelve [] salvo las aclaraciones fijas de un plan pago de la beta.
 */
export function planExclusions(plan: PlanDef, reference: PlanDef, enabled: Enabled): string[] {
  const out: string[] = [];
  const a = plan.limits;
  const r = reference.limits;
  if (a.evaluationsPerDay < r.evaluationsPerDay) {
    out.push(
      `No llega a las ${r.evaluationsPerDay} ofertas por día: el tope es ${a.evaluationsPerDay}`,
    );
  }
  if (a.targetRoles < r.targetRoles) {
    out.push(`No llega a ${r.targetRoles} carreras a la vez: el tope es ${a.targetRoles}`);
  }
  if (enabled.cv && a.cvReadsPerMonth < r.cvReadsPerMonth) {
    out.push(
      `No llega a ${r.cvReadsPerMonth} lecturas de CV por mes: el tope es ${a.cvReadsPerMonth}`,
    );
  }
  if (enabled.assistant && a.conversationsPerMonth < r.conversationsPerMonth) {
    out.push(
      `No llega a ${r.conversationsPerMonth} charlas con el asistente por mes: el tope es ${a.conversationsPerMonth}`,
    );
  }
  // Dicho en la página de precios (preguntas frecuentes): durante la beta no hay factura
  if (plan.billing === "mensual") out.push("Sin factura durante la beta");
  return out;
}
