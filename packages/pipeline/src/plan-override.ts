/**
 * Precio especial por persona (ADR-040). Puro: recibe el entorno y la marca ya leídos y decide qué se le
 * ofrece para pagar. La marca vive en `plan_overrides`, una tabla que la persona puede leer pero no escribir;
 * solo el admin la pone, por una función de la base. Ningún monto cambia acá: el 50 % lo da el link de
 * Mercado Pago que sale de `MP_LINK_TESTER_50`.
 */
import { paymentLink, safePaymentUrl, type PlanKey } from "./plans";

export const PLAN_OVERRIDES = ["becado", "tester_50"] as const;
export type PlanOverride = (typeof PLAN_OVERRIDES)[number];

export const PLAN_OVERRIDE_LABELS: Record<PlanOverride, string> = {
  becado: "Becado (plan bonificado)",
  tester_50: "Tester (50 % de descuento)",
};

/** Variable con el link de Mercado Pago del precio especial de los testers. */
export const TESTER_50_LINK_ENV = "MP_LINK_TESTER_50";

export function isPlanOverride(value: unknown): value is PlanOverride {
  return typeof value === "string" && (PLAN_OVERRIDES as readonly string[]).includes(value);
}

/** Qué se le muestra a la persona para pagar. */
export type PaymentOffer =
  /** Un link de pago de Mercado Pago ya validado (el del plan o el del precio especial). */
  | { kind: "link"; url: string }
  /** Sin link: que escriba al equipo, como cuando no hay link cargado. */
  | { kind: "sin_link" }
  /** Plan bonificado: no hay nada que pagar. */
  | { kind: "bonificado"; message: string }
  /** Tiene una marca de precio especial pero falta su link: se le pide que escriba al equipo. */
  | { kind: "escribir"; message: string };

export const BONIFICADO_MESSAGE = "Tu plan está bonificado.";
export const ESCRIBIR_MESSAGE =
  "Tenés un precio especial: escribinos y te pasamos el link para pagarlo.";

/**
 * Qué ofrecer para pagar el plan `key`. Sin marca queda igual que antes (`paymentLink`). Con marca:
 * `becado` no paga; `tester_50` usa su propio link y, si falta o no es válido, **falla cerrado**: nunca
 * se muestra el link de precio completo como si fuera el descuento. Una marca desconocida tampoco.
 */
export function paymentOffer(
  env: Record<string, string | undefined>,
  key: PlanKey,
  override: unknown,
): PaymentOffer {
  if (override === null || override === undefined) {
    const url = paymentLink(env, key);
    return url ? { kind: "link", url } : { kind: "sin_link" };
  }
  if (override === "becado") return { kind: "bonificado", message: BONIFICADO_MESSAGE };
  if (override === "tester_50") {
    const url = safePaymentUrl(env[TESTER_50_LINK_ENV]);
    return url ? { kind: "link", url } : { kind: "escribir", message: ESCRIBIR_MESSAGE };
  }
  return { kind: "escribir", message: ESCRIBIR_MESSAGE };
}
