/**
 * Pantalla «qué sigue» del cierre (ADR-034 §9, R10-5). Copy fijo, escrito a mano: no lo redacta el modelo
 * y nunca promete trabajo, entrevistas ni sueldos (un test recorre los textos). Puro.
 *
 * Con el onboarding completo (`app`) los tres pasos llevan a su pantalla. Durante el onboarding esas
 * pantallas no se alcanzan (el layout de `(app)` redirige), así que el único link es «Terminar tu
 * perfil» y el resto se muestra como lo que viene después, sin link.
 */
import type { ProfileAgentBase } from "../routes";

export type ProfileAgentNextStepId = "finish_profile" | "alerts" | "offers" | "plan";

export interface ProfileAgentNextStep {
  id: ProfileAgentNextStepId;
  title: string;
  text: string;
  /** `null` = solo informativo (todavía no se alcanza la pantalla). */
  href: string | null;
}

const STEPS: Record<
  Exclude<ProfileAgentNextStepId, "finish_profile">,
  Omit<ProfileAgentNextStep, "href"> & { href: string }
> = {
  alerts: {
    id: "alerts",
    title: "Reenviá tus alertas de empleo",
    text: "Creá alertas en los portales con las palabras que te sugerimos y reenviá los avisos a tu dirección de reenvío. Así los leemos contra tu perfil.",
    href: "/settings",
  },
  offers: {
    id: "offers",
    title: "Mirá tus ofertas",
    text: "Revisá las ofertas de tus puestos, con lo que encaja y lo que no con tu perfil.",
    href: "/jobs",
  },
  plan: {
    id: "plan",
    title: "Seguí tu plan de skills",
    text: "Mirá qué skills piden las ofertas de tu carrera y cuáles te conviene reforzar primero.",
    href: "/plan",
  },
};

const FINISH: ProfileAgentNextStep = {
  id: "finish_profile",
  title: "Terminá tu perfil",
  text: "Revisá lo que ya cargamos, completá lo que falte y seguí con tus primeras ofertas.",
  href: "/onboarding",
};

export function profileAgentNextSteps(base: ProfileAgentBase): ProfileAgentNextStep[] {
  if (base === "onboarding") {
    // Lo que viene después, sin link: esas pantallas se abren al terminar el perfil
    return [
      FINISH,
      ...(["alerts", "offers", "plan"] as const).map((id) => ({ ...STEPS[id], href: null })),
    ];
  }
  return (["alerts", "offers", "plan"] as const).map((id) => ({ ...STEPS[id] }));
}

/** Todo el copy fijo de la pantalla, para el test de promesas. */
export function profileAgentNextStepsCopy(): string[] {
  return [FINISH, ...Object.values(STEPS)].flatMap((s) => [s.title, s.text]);
}
