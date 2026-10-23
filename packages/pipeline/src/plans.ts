/**
 * Planes de la beta paga (C-11). Puro: recibe el entorno ya leído y devuelve decisiones.
 *
 * Es la fuente única de los planes, sus topes y sus precios: la pantalla «Tu plan», la página
 * pública `/precios` y los topes por persona salen de acá. Todo queda detrás de `PRICING_ENABLED`
 * (apagado por defecto): con el flag apagado no hay página de precios y los topes son los de siempre.
 *
 * El cobro no pasa por la app: cada plan pago tiene un link externo de Mercado Pago que sale de una
 * variable (`MP_LINK_*`). Sin API, sin secretos y sin webhooks; el cambio de plan lo carga Mauro.
 */

export const PLAN_KEYS = ["gratis", "fundador", "lista", "pase_3_meses"] as const;
export type PlanKey = (typeof PLAN_KEYS)[number];

export type PlanLimits = {
  /** Evaluaciones del pool por día. */
  evaluationsPerDay: number;
  /** Lecturas de CV por mes (la 81: 1 gratis, 5 pago). */
  cvReadsPerMonth: number;
  /** Conversaciones con el asistente por mes (diseño de la 100: 3 gratis, 30 pago). */
  conversationsPerMonth: number;
  /** Carreras que se pueden seguir a la vez (ADR-016). */
  targetRoles: number;
};

export type PlanDef = {
  key: PlanKey;
  name: string;
  /** Una línea para la tarjeta de `/precios`. */
  summary: string;
  /** Precio en pesos argentinos; null = todavía no está decidido y la página dice «a confirmar». */
  priceArs: number | null;
  billing: "gratis" | "mensual" | "pago_unico";
  /** Cuánto dura lo que se paga; null = mientras siga pagando (o para siempre, en el gratis). */
  durationDays: number | null;
  /** Variable con el link de pago de Mercado Pago; null en el gratis. */
  paymentLinkEnv: `MP_LINK_${string}` | null;
  limits: PlanLimits;
};

// A confirmar con Ani: precios, duración y topes. Mientras tanto, los precios quedan en null para no
// publicar una cifra inventada; los topes salen de lo que ya rige (la 81, la 100 y ADR-016).
const FREE_LIMITS: PlanLimits = {
  evaluationsPerDay: 3,
  cvReadsPerMonth: 1,
  conversationsPerMonth: 3,
  targetRoles: 2,
};
const PAID_LIMITS: PlanLimits = {
  evaluationsPerDay: 15,
  cvReadsPerMonth: 5,
  conversationsPerMonth: 30,
  targetRoles: 4,
};

export const PLANS: readonly PlanDef[] = [
  {
    key: "gratis",
    name: "Gratis",
    summary: "Para probar con tu carrera principal.",
    priceArs: 0,
    billing: "gratis",
    durationDays: null,
    paymentLinkEnv: null,
    limits: FREE_LIMITS,
  },
  {
    key: "fundador",
    name: "Fundador",
    summary: "Precio de lanzamiento para las primeras personas de cada carrera.",
    priceArs: null,
    billing: "mensual",
    durationDays: null,
    paymentLinkEnv: "MP_LINK_FUNDADOR",
    limits: PAID_LIMITS,
  },
  {
    key: "lista",
    name: "Mensual",
    summary: "El plan completo, mes a mes.",
    priceArs: null,
    billing: "mensual",
    durationDays: null,
    paymentLinkEnv: "MP_LINK_LISTA",
    limits: PAID_LIMITS,
  },
  {
    key: "pase_3_meses",
    name: "Pase de 3 meses",
    summary: "Un solo pago para una búsqueda entera.",
    priceArs: null,
    billing: "pago_unico",
    durationDays: 90,
    paymentLinkEnv: "MP_LINK_PASE_3_MESES",
    limits: PAID_LIMITS,
  },
];

/** Días de garantía: si no te sirve, te devolvemos lo que pagaste. */
export const GUARANTEE_DAYS = 14;

export function isPlanKey(v: unknown): v is PlanKey {
  return typeof v === "string" && (PLAN_KEYS as readonly string[]).includes(v);
}

export function planDef(key: PlanKey): PlanDef {
  // PLANS tiene una fila por clave (lo verifica un test)
  return PLANS.find((p) => p.key === key)!;
}

/** `PRICING_ENABLED` se comprueba en el servidor: ausente o distinto de "1" = apagado. */
export function pricingEnabled(env: Record<string, string | undefined>): boolean {
  return env.PRICING_ENABLED === "1";
}

const PAYMENT_HOSTS = [
  "mpago.la",
  "mpago.li",
  "mercadopago.com.ar",
  "www.mercadopago.com.ar",
  "link.mercadopago.com.ar",
  "mercadopago.com",
  "www.mercadopago.com",
];

/**
 * Link de pago de un plan, solo si la variable trae una URL https de Mercado Pago. Cualquier otra
 * cosa (vacío, http, otro dominio, texto) devuelve null y la página muestra «Pronto», sin link.
 */
export function paymentLink(env: Record<string, string | undefined>, key: PlanKey): string | null {
  const name = planDef(key).paymentLinkEnv;
  const raw = name ? env[name]?.trim() : undefined;
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    return PAYMENT_HOSTS.includes(url.hostname) ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * Plan que rige hoy: un plan pago con fecha de fin vencida vuelve a gratis, y un valor desconocido
 * también (falla cerrado hacia el plan con menos topes).
 */
export function effectivePlan(plan: unknown, planUntil: Date | null, now: Date): PlanKey {
  if (!isPlanKey(plan)) return "gratis";
  if (plan !== "gratis" && planUntil && planUntil.getTime() <= now.getTime()) return "gratis";
  return plan;
}

/**
 * Topes de un plan, solo con los precios encendidos. Con `PRICING_ENABLED` apagado devuelve null y
 * cada llamador usa el tope de siempre (la variable o su default), así el flag apagado no cambia nada.
 */
export function planLimitsFor(
  env: Record<string, string | undefined>,
  plan: PlanKey,
): PlanLimits | null {
  return pricingEnabled(env) ? planDef(plan).limits : null;
}

/**
 * Tope de una persona para un recurso (C-11b), en este orden:
 * 1. el tope propio del perfil, si Mauro lo fijó a mano (`max_target_roles`, `pool_daily_eval_limit`);
 * 2. el del plan que rige hoy, solo con `PRICING_ENABLED`;
 * 3. el de siempre (la variable de entorno o su default), que trae el llamador.
 */
export function resolvePlanLimit(
  env: Record<string, string | undefined>,
  key: keyof PlanLimits,
  input: {
    override: number | null;
    plan: unknown;
    planUntil: Date | null;
    now: Date;
    fallback: number;
  },
): number {
  if (input.override !== null) return input.override;
  const limits = planLimitsFor(env, effectivePlan(input.plan, input.planUntil, input.now));
  return limits ? limits[key] : input.fallback;
}

/** Precio para mostrar: «Gratis», «$ 1.234 por mes» o «Precio a confirmar». */
export function priceLabel(plan: PlanDef): string {
  if (plan.billing === "gratis") return "Gratis";
  if (plan.priceArs === null) return "Precio a confirmar";
  const amount = `$ ${plan.priceArs.toLocaleString("es-AR")}`;
  return plan.billing === "mensual" ? `${amount} por mes` : `${amount}, un solo pago`;
}

/**
 * Topes en palabras, para la tarjeta del plan. La lectura del CV y el asistente solo aparecen si
 * están encendidos: la página de precios no promete funciones que todavía no existen.
 */
export function limitsText(
  limits: PlanLimits,
  enabled: { cv: boolean; assistant: boolean },
): string[] {
  const n = (v: number, one: string, many: string) => `${v} ${v === 1 ? one : many}`;
  return [
    `${n(limits.evaluationsPerDay, "oferta evaluada", "ofertas evaluadas")} por día`,
    `${n(limits.targetRoles, "carrera", "carreras")} a la vez`,
    ...(enabled.cv ? [`${n(limits.cvReadsPerMonth, "lectura", "lecturas")} de CV por mes`] : []),
    ...(enabled.assistant
      ? [`${n(limits.conversationsPerMonth, "charla", "charlas")} con el asistente por mes`]
      : []),
  ];
}
