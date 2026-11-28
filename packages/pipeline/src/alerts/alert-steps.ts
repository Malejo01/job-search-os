/**
 * Guía de alertas paso a paso, por carrera (R32-04). Puro: no abre ningún portal ni crea ninguna alerta (ADR-004):
 * las alertas las arma cada persona por su cuenta en cada portal. Acá solo se dice qué hacer, con qué palabras y
 * cómo hacer que esos emails lleguen a la dirección de la app. Los portales y las palabras salen de `portal-guide`,
 * para que esta guía, la del onboarding y el aviso de pocas ofertas nombren siempre lo mismo.
 */
import { BRAND } from "../brand";
import {
  alertKeywordsFor,
  isAutomaticPortal,
  portalsForRoles,
  type AlertLanguage,
  type AlertPortal,
  type AlertPortalId,
} from "./portal-guide";
import type { PortalStatsRow } from "./portal-stats";

/**
 * Cómo llegan los emails de esa alerta a la app:
 * - `directa`: se escribe la dirección de la app como email de la alerta (Computrabajo, sin cuenta).
 * - `reenviar`: la alerta llega al email de la persona y se reenvía a la app (a mano o con los filtros de Gmail).
 * - `pegar`: todavía no leemos los emails de ese portal; se pega el aviso.
 */
export type AlertDelivery = "directa" | "reenviar" | "pegar";

const ADDRESS = `tu dirección de ${BRAND.name}`;
const FORWARD = `Reenviá cada email a ${ADDRESS}, o importá los filtros de Gmail del asistente para que se reenvíen solos.`;
const PASTE = (portal: string) =>
  `Todavía no leemos los emails de ${portal}: cuando veas una oferta que te interese, pegala en «Cargar una oferta».`;

export const PORTAL_ALERT_STEPS: Record<
  AlertPortalId,
  { steps: readonly string[]; delivery: AlertDelivery }
> = {
  linkedin: {
    delivery: "reenviar",
    steps: [
      "Entrá a LinkedIn › Empleos y buscá con una de las palabras de arriba.",
      "Elegí tu país o tu ciudad en el filtro de ubicación.",
      "Tocá «Crear alerta de empleo» y elegí frecuencia diaria.",
      FORWARD,
    ],
  },
  indeed: {
    delivery: "reenviar",
    steps: [
      "Entrá a Indeed y buscá con una de las palabras de arriba.",
      "Escribí tu ciudad o tu país en el campo de ubicación.",
      "Activá «Recibir nuevas ofertas por email», debajo del buscador.",
      FORWARD,
    ],
  },
  getonboard: {
    delivery: "reenviar",
    steps: [
      "Entrá a Get on Board con tu cuenta.",
      "Abrí Alertas (o «Guardar búsqueda») y elegí las categorías o las palabras de arriba.",
      "Dejá el email de tu cuenta para recibirlas.",
      FORWARD,
    ],
  },
  bumeran: {
    delivery: "reenviar",
    steps: [
      "Entrá a Bumeran con tu cuenta: te pide iniciar sesión.",
      "Buscá con una de las palabras de arriba.",
      "Guardá la búsqueda como alerta por email.",
      FORWARD,
    ],
  },
  zonajobs: {
    delivery: "pegar",
    steps: [
      "Entrá a ZonaJobs con tu cuenta: te pide iniciar sesión.",
      "Buscá con una de las palabras de arriba.",
      "Guardá la búsqueda como alerta por email.",
      PASTE("ZonaJobs"),
    ],
  },
  computrabajo: {
    delivery: "directa",
    steps: [
      "Entrá a Computrabajo y buscá con una de las palabras de arriba.",
      `Tocá «Crear alerta» y escribí ${ADDRESS} como email. No hace falta crear una cuenta.`,
      "Computrabajo te manda un email para confirmar: abrilo en tu Bandeja y tocá el link de confirmación.",
    ],
  },
};

export type AlertGuideForCareer = {
  career: string;
  /** Palabras para crear las alertas, en el idioma de la persona. */
  keywords: string[];
  /** Portales que conviene para esa carrera, con sus pasos. */
  portals: {
    portal: AlertPortal;
    steps: readonly string[];
    delivery: AlertDelivery;
    /** Leemos sus emails solos (si no, se pega el aviso). */
    automatic: boolean;
  }[];
};

/** La guía de una carrera: sus palabras y sus portales con los pasos de cada uno. */
export function alertGuideForCareer(career: string, language: AlertLanguage): AlertGuideForCareer {
  return {
    career,
    keywords: alertKeywordsFor([career], language),
    portals: portalsForRoles([career]).map((portal) => ({
      portal,
      steps: PORTAL_ALERT_STEPS[portal.id].steps,
      delivery: PORTAL_ALERT_STEPS[portal.id].delivery,
      automatic: isAutomaticPortal(portal.id),
    })),
  };
}

/** Una guía por carrera de la persona, en el orden recibido y sin repetir. Sin carreras, ninguna. */
export function alertGuideForRoles(
  roles: readonly string[],
  language: AlertLanguage,
): AlertGuideForCareer[] {
  return [...new Set(roles)].map((role) => alertGuideForCareer(role, language));
}

/** Los grupos de `sourceGroupOf` que son un portal de la guía, y cuál. */
const PORTAL_OF_GROUP: Readonly<Record<string, AlertPortalId>> = {
  LinkedIn: "linkedin",
  Indeed: "indeed",
  "Get on Board": "getonboard",
  Bumeran: "bumeran",
  ZonaJobs: "zonajobs",
  Computrabajo: "computrabajo",
};

/**
 * Cuántas ofertas le llegaron a la persona por cada portal de la guía (los últimos 30 días, según la primera
 * fuente de cada oferta). Lo que no es de un portal de la guía (el pool, lo que cargó a mano, un email sin portal)
 * no se atribuye a ninguno.
 */
export function alertCountsByPortal(
  rows: readonly PortalStatsRow[],
): Partial<Record<AlertPortalId, number>> {
  const out: Partial<Record<AlertPortalId, number>> = {};
  for (const row of rows) {
    const id = Object.hasOwn(PORTAL_OF_GROUP, row.group) ? PORTAL_OF_GROUP[row.group] : undefined;
    if (id) out[id] = (out[id] ?? 0) + row.total;
  }
  return out;
}
