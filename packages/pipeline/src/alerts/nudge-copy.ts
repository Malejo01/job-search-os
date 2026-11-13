/**
 * Texto del aviso de alertas del cierre del onboarding (R11-10). Puro. Es un solo mensaje, y los
 * portales que nombra salen de la misma función que usa la guía (`portalGroupsForRoles`): los dos
 * dicen siempre lo mismo. Si la carrera tiene pocas ofertas en el idioma de la persona, el mismo
 * mensaje lo dice y suma el camino de cargar ofertas.
 */
import { FEW_OFFERS_THRESHOLD, languageNoun } from "./few-offers";
import { portalGroupsForRoles, portalListText, type AlertLanguage } from "./portal-guide";

export type NudgeCopy = {
  title: string;
  body: string;
  cta: string;
  /** Segundo camino (cargar una oferta); null si no hace falta. */
  secondary: { label: string; href: string } | null;
};

/** «A, B y C». Sin la regla de «e» de `portalListText`: son nombres de carrera. */
export function joinLabels(labels: readonly string[]): string {
  if (labels.length <= 1) return labels.join("");
  return `${labels.slice(0, -1).join(", ")} y ${labels[labels.length - 1]}`;
}

export function nudgeCopy(input: {
  roles: readonly string[];
  language: AlertLanguage;
  /** Etiquetas de las carreras con menos de `FEW_OFFERS_THRESHOLD` ofertas en el idioma de la persona. */
  few: readonly string[];
}): NudgeCopy {
  const { automatic, manual } = portalGroupsForRoles(input.roles);
  const auto = portalListText(automatic);
  const paste = manual.length ? ` De ${portalListText(manual)}, por ahora, pegá el aviso.` : "";
  if (input.few.length === 0) {
    return {
      title: `Sumá tus alertas de ${auto}`,
      body: `Reenviá las alertas que ya te llegan y las evaluamos junto con estas.${paste} Toma unos 5 minutos.`,
      cta: "Conectar mis alertas",
      secondary: null,
    };
  }
  return {
    title: `Hay pocas ofertas de ${joinLabels(input.few)} en ${languageNoun(input.language)} esta semana`,
    body: `Encontramos menos de ${FEW_OFFERS_THRESHOLD}. Para ver más, sumá tus alertas de ${auto} o cargá una oferta que hayas visto.${paste}`,
    cta: "Conectar mis alertas",
    secondary: { label: "Cargar una oferta (texto o imagen)", href: "/jobs/new" },
  };
}
