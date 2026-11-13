/**
 * Rutas y claves del navegador del agente de perfil (ADR-034). Una sola fuente para que los tickets que
 * trabajan en paralelo (R10-1 a R10-5) no se pongan de acuerdo por chat. Puro.
 *
 * El flujo corre en dos árboles de rutas porque el layout de `(app)` redirige al onboarding mientras el
 * perfil esté incompleto: `app` (con el onboarding completo) y `onboarding` (primer paso opcional). Las
 * páginas de los dos árboles son envoltorios finos sobre los mismos componentes; `profileAgentPath` arma
 * el link a la etapa que sigue sin que el componente sepa en cuál de los dos está.
 */

export const PROFILE_AGENT_STAGE_SEGMENTS = {
  read: "",
  gaps: "/huecos",
  guide: "/guia",
  done: "/listo",
} as const;
export type ProfileAgentPageStage = keyof typeof PROFILE_AGENT_STAGE_SEGMENTS;

export const PROFILE_AGENT_BASES = { app: "/cv/perfil", onboarding: "/onboarding/cv" } as const;
export type ProfileAgentBase = keyof typeof PROFILE_AGENT_BASES;

/** `profileAgentPath("onboarding", "gaps")` → `/onboarding/cv/huecos`. */
export function profileAgentPath(base: ProfileAgentBase, stage: ProfileAgentPageStage): string {
  return `${PROFILE_AGENT_BASES[base]}${PROFILE_AGENT_STAGE_SEGMENTS[stage]}`;
}

/** Un endpoint por etapa, bajo el mismo prefijo. Cada ticket crea el suyo y no toca el de otro. */
export const PROFILE_AGENT_API = {
  read: "/api/cv-perfil/leer",
  cards: "/api/cv-perfil/tarjetas",
  gaps: "/api/cv-perfil/huecos",
  guide: "/api/cv-perfil/guia",
  close: "/api/cv-perfil/cierre",
} as const;

/**
 * `sessionStorage` (por pestaña, se borra al cerrarla): el ticket firmado y el estado de la charla. No
 * guardan el texto del CV ni la charla (el esquema de `profileAgentStateSchema` no tiene dónde), y
 * nunca `localStorage`. Si faltan o no validan, la página vuelve a la lectura.
 */
export const PROFILE_AGENT_STORAGE_KEYS = {
  ticket: "jso:pa:ticket",
  state: "jso:pa:state",
  /**
   * La propuesta de la lectura (tarjetas ya revisadas, atadas al ticket), para que recargar antes de guardar
   * no gaste otra lectura del cupo. No es el texto del CV: ver `read/stored.ts`.
   */
  read: "jso:pa:read",
} as const;
