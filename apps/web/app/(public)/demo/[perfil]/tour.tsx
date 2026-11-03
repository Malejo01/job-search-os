"use client";

import { GuidedTour, type TourStep } from "@/components/guided-tour";

/**
 * Recorrido de la demo (ronda 74): 5 pasos con el componente compartido de la guía (ronda 92). Las
 * anclas `demo:*` las ponen la página y la primera tarjeta. No se autoabre: lo abre «Ver recorrido».
 */
const STEPS: readonly TourStep[] = [
  {
    anchor: "demo:perfil",
    title: "Este es el perfil",
    text: "Es una persona inventada: lo que sabe y lo que busca.",
  },
  {
    anchor: "demo:puntaje",
    title: "El puntaje",
    text: "De 0 a 10: qué tan bien calza la oferta con este perfil.",
  },
  {
    anchor: "demo:por-que",
    title: "Por qué sí y por qué no",
    text: "Lo que juega a favor, y lo que falta, impide o arriesga.",
  },
  {
    anchor: "demo:accion",
    title: "La acción sugerida",
    text: "Qué haría el sistema. La decisión siempre es tuya.",
  },
  {
    anchor: "demo:acceso",
    title: "¿Querés verlo con tu perfil?",
    text: "Pedí acceso: la beta es por invitación y el cupo es limitado.",
  },
];

const OPENER =
  "inline-flex min-h-11 items-center justify-center rounded-control bg-brand px-4 text-sm font-medium text-brand-contrast hover:bg-brand-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

export function Tour() {
  return (
    <GuidedTour
      steps={STEPS}
      label="Recorrido guiado"
      testId="demo-tour"
      openerLabel="Ver recorrido"
      openerClassName={OPENER}
      finalAction={{ label: "Pedir acceso", href: "/acceso" }}
    />
  );
}
