/**
 * Texto de la pantalla de plan vencido (R22-03). Puro: arma qué se mantiene y qué se pausa cuando vence el
 * plan pago. Lo que se pausa sale de los topes reales (`planExclusions`: plan gratis contra el de la beta),
 * así el texto no puede prometer ni quitar algo que los topes no dicen. Vencer nunca borra nada (C3-1).
 */
import { BRAND } from "./brand";
import { BETA_PLAN, planDef } from "./plans";
import { planExclusions } from "./pricing-v2";

export type ExpiredPlanSummary = {
  title: string;
  intro: string;
  /** Lo que sigue igual. */
  keeps: string[];
  /** Lo que deja de incluir el plan gratis, en palabras. */
  pauses: string[];
};

export function expiredPlanSummary(enabled: {
  cv: boolean;
  assistant: boolean;
}): ExpiredPlanSummary {
  return {
    title: "Tu plan completo terminó, y tu cuenta sigue como estaba",
    intro: `No se borró nada. Podés seguir usando ${BRAND.name} con el plan gratis y volver al completo cuando quieras.`,
    keeps: [
      "Tus datos y tu perfil",
      "Tus ofertas, con sus puntajes y tus notas",
      "Tu CV y tus versiones guardadas",
      "Tu historial y tus postulaciones marcadas",
    ],
    pauses: planExclusions(planDef("gratis"), planDef(BETA_PLAN), enabled),
  };
}
