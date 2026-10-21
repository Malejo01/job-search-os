import { cookies } from "next/headers";
import type { TourInvite, TourStep } from "@/components/guided-tour";

/**
 * Guía de cada pantalla (ronda 92): textos fijos, sin LLM y sin datos de la persona. Cada paso
 * declara su `anchor` (`data-tour` del elemento a resaltar); si el elemento no está en pantalla,
 * el paso se saltea. Los textos de modalidad, autorización e inglés copian los de la pantalla:
 * si cambian allá, se cambian acá.
 */
export type GuideScreen = "perfil" | "skills" | "ofertas" | "jobs";

export const GUIDE_STEPS: Record<GuideScreen, readonly TourStep[]> = {
  perfil: [
    {
      anchor: "perfil:puestos",
      title: "Qué buscás",
      text: "Elegí los puestos que te interesan. Te mostramos primero esas ofertas. Los cambiás cuando quieras en Ajustes.",
    },
    {
      anchor: "perfil:pais-ingles",
      title: "Dónde estás y tu inglés",
      text: "Muchos avisos solo aceptan ciertos países o piden un nivel de inglés. Con esto descartamos los que no te sirven. Si dudás entre dos niveles, elegí el más bajo.",
    },
    {
      anchor: "perfil:modalidad",
      title: "Cómo querés trabajar",
      text: "Marcá todas las opciones que te sirvan. Las ofertas de otra modalidad no te van a aparecer.",
    },
    {
      anchor: "perfil:autorizacion",
      title: "Autorización de trabajo",
      text: "Completalo solo si tenés ciudadanía, residencia o visa de trabajo en otro país. Si no, dejalo vacío.",
    },
    {
      anchor: "perfil:resumen",
      title: "Tu resumen",
      text: "Contá qué hacés bien, qué usaste poco y qué no sabés. Lo lee la IA para evaluar cada aviso. El contador te avisa antes de llegar al máximo: no hace falta pegar el CV entero.",
    },
    {
      anchor: "perfil:guardar",
      title: "Guardar",
      text: "Si falta algo, te marcamos el campo y no se borra nada de lo que cargaste.",
    },
  ],
  skills: [
    {
      anchor: "skills:puestos",
      title: "Skills por puesto",
      text: "Tocá un puesto y te mostramos las skills que más piden esas ofertas.",
    },
    {
      anchor: "skills:nivel",
      title: "Tu nivel real",
      text: 'Elegí lo que de verdad hiciste. Si no sabés qué es una skill, tocá "¿Qué es esto?".',
    },
    {
      anchor: "skills:buscar",
      title: "¿No está la tuya?",
      text: "Buscala por nombre o agregala a mano.",
    },
    {
      anchor: "skills:saltear",
      title: "Es opcional",
      text: "Podés saltearlo y completarlo después en Ajustes.",
    },
  ],
  ofertas: [
    {
      anchor: "ofertas:lista",
      title: "De dónde salen",
      text: "De portales públicos, ordenadas por lo que nos contaste. La IA evalúa las primeras ahora.",
    },
    {
      anchor: "ofertas:email",
      title: "Tus alertas (opcional)",
      text: "Si te llegan alertas de LinkedIn u otro portal, reenvialas y las evaluamos junto con estas.",
    },
    {
      anchor: "ofertas:seguir",
      title: "Listo",
      text: 'Desde "Ir a mis ofertas" ves todo y decidís qué hacer con cada una.',
    },
  ],
  jobs: [
    {
      anchor: "jobs:primeros-pasos",
      title: "Tus primeros pasos",
      text: "Esta lista se tilda sola a medida que usás la app. La podés ocultar.",
    },
    {
      anchor: "jobs:puntaje",
      title: "El puntaje",
      text: "De 0 a 10: qué tan bien calza con tu perfil. Si el borde es punteado, es una estimación sin IA.",
    },
    {
      anchor: "jobs:etiquetas",
      title: "Las etiquetas",
      text: "Rojo: te impide postular. Ámbar: es un riesgo, podés postular igual. Abrí la oferta para ver el porqué.",
    },
    {
      anchor: "jobs:opinion",
      title: "Tu opinión",
      text: "👍 si la evaluación te ayudó, 👎 si se equivocó. Nunca postulamos por vos.",
    },
    {
      anchor: "jobs:menu",
      title: "Sin descripción",
      text: 'Algunos avisos llegan sin texto. Entrá a "Sin descripción" (en el celular, desde "Menú"), pegalo ahí y se evalúa.',
    },
  ],
};

/** Textos del panel y del botón, iguales en todas las pantallas de la app. */
export const GUIDE_LABELS = {
  panel: "Guía de esta pantalla",
  opener: "Ver guía",
} as const;

/** Invitación del paso 1 del onboarding. «Ver la guía» y no «Ver guía»: el botón fijo ya se llama así. */
export const GUIDE_INVITE: TourInvite = {
  text: "¿Primera vez? En un minuto te mostramos qué pide cada parte.",
  startLabel: "Ver la guía",
  dismissLabel: "No, gracias",
  testId: "guide-invite",
};

/** Cookie de «ya la vio o la rechazó»: solo UX (httpOnly, un año), con el id del usuario como valor. */
export const GUIDE_COOKIE = "jso_guia";
export const GUIDE_MAX_AGE = 60 * 60 * 24 * 365;

/** ¿La persona ya cerró la invitación? Lee solo la cookie: cero queries. */
export async function guideDismissed(userId: string): Promise<boolean> {
  const jar = await cookies();
  return jar.get(GUIDE_COOKIE)?.value === userId;
}
