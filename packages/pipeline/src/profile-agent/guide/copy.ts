/**
 * Textos fijos de la guía de búsqueda (ADR-034 §1, R10-4). La guía no usa el modelo: todo lo que se muestra
 * sale de acá o de datos. Un test recorre estos textos y falla ante una promesa (trabajo, entrevistas o
 * sueldos). Puro.
 */
import type { MODALITIES } from "../../onboarding";
import type { GuideStep, ProfileGuideCard } from "../schemas";

export const GUIDE_STEP_COPY: Record<GuideStep, { title: string; question: string; help: string }> =
  {
    roles: {
      title: "Puestos",
      question: "¿Qué puestos te interesan?",
      help: "Elegí hasta cuatro. El primero es el principal. Después lo podés cambiar en tu perfil.",
    },
    modality: {
      title: "Modalidad",
      question: "¿En qué modalidad te sirve trabajar?",
      help: "Podés marcar más de una.",
    },
    country: {
      title: "País",
      question: "¿Desde qué país vas a trabajar?",
      help: "Lo usamos para marcar las ofertas que piden estar en otro lugar.",
    },
    seniority: {
      title: "Experiencia pedida",
      question: "¿Hasta cuántos años de experiencia aceptás que pida una oferta?",
      help: "Las ofertas que pidan más que esto las marcamos como poco compatibles.",
    },
    salary: {
      title: "Pretensión",
      question: "¿Tenés un mínimo mensual en dólares? Podés dejarlo vacío.",
      help: "Es un filtro tuyo: nos sirve para avisarte qué ofertas publican menos que eso. No es una estimación de sueldos del mercado.",
    },
    avoid: {
      title: "Qué evitar",
      question: "¿Hay palabras de título de puesto que quieras evitar?",
      help: "Por ejemplo «ventas puerta a puerta» o «guardia». Una por línea, hasta diez, o dejalo vacío.",
    },
  };

export const GUIDE_MODALITY_LABELS: Record<(typeof MODALITIES)[number], string> = {
  remoto: "Remoto",
  hibrido: "Híbrido",
  presencial: "Presencial",
};

/** Seniority = años máximos de experiencia que se aceptan (`max_years_hard`, mínimo 1). */
export const GUIDE_SENIORITY_OPTIONS: readonly { years: number; label: string }[] = [
  { years: 2, label: "Hasta 2 años (recién empiezo)" },
  { years: 4, label: "Hasta 4 años" },
  { years: 6, label: "Hasta 6 años" },
  { years: 10, label: "Hasta 10 años" },
  { years: 40, label: "Sin tope de años" },
];

export const GUIDE_MAX_AVOID_ENTRIES = 10;
export const GUIDE_AVOID_MAX_CHARS = 60;

export const GUIDE_DISCLAIMER =
  "Esto es una guía armada con tus respuestas y con datos de ofertas publicadas. Nada se guarda hasta que lo confirmes.";

export const GUIDE_FORWARD_LINKS = { app: "/inbox", onboarding: "/onboarding/ofertas" } as const;

export const GUIDE_CARD_TITLES: Record<ProfileGuideCard["kind"], string> = {
  roles: "Tus puestos",
  criteria: "Tus criterios de búsqueda",
  alert_keywords: "Palabras para tus alertas",
  reinforce: "Una skill para reforzar",
};

export const GUIDE_CARD_NOTES: Record<ProfileGuideCard["kind"], string> = {
  roles: "Se guardan en tu perfil y ordenan las ofertas que ves.",
  criteria:
    "Con esto filtramos y marcamos las ofertas. Si todavía estás completando tu perfil, queda para el formulario.",
  alert_keywords:
    "Creá la alerta en el portal con estas palabras y reenviala a tu dirección de la app. Nosotros no entramos a ningún portal.",
  reinforce:
    "Sale de lo que piden las ofertas publicadas de tu carrera contra tus skills. Se suma a tu plan.",
};

export const GUIDE_PORTAL_NAMES = {
  linkedin: "LinkedIn",
  indeed: "Indeed",
  getonboard: "Get on Board",
} as const;

/** Cuántas ofertas lo piden, en palabras y sin proyectar nada. */
export function reinforceEvidenceText(offersAsking: number, poolSize: number): string {
  return `${offersAsking} de ${poolSize} ofertas publicadas de tu carrera la piden.`;
}

/** Todos los textos fijos, para el test que busca promesas. */
export function allGuideCopy(): string[] {
  return [
    ...Object.values(GUIDE_STEP_COPY).flatMap((c) => [c.title, c.question, c.help]),
    ...Object.values(GUIDE_MODALITY_LABELS),
    ...GUIDE_SENIORITY_OPTIONS.map((o) => o.label),
    GUIDE_DISCLAIMER,
    ...Object.values(GUIDE_CARD_TITLES),
    ...Object.values(GUIDE_CARD_NOTES),
    ...Object.values(GUIDE_PORTAL_NAMES),
    reinforceEvidenceText(3, 10),
  ];
}

/** Promesas que la guía nunca hace: trabajo, entrevistas, sueldos o resultados asegurados. */
export const GUIDE_PROMISE_RE =
  /garantiz|garantía|garantia|asegur(amos|ado|ada|o que)|conseguir(as|ás)|vas a conseguir|te van a (llamar|contratar|entrevistar)|conseguirás|sueldo de|vas a cobrar|cobrarás|ganarás|vas a ganar|entrevistas? asegurad|seguro que/i;
