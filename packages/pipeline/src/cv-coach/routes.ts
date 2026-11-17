/**
 * Rutas y claves del navegador del coach de CV (ADR-038). Una sola fuente para R12-8 a R12-11. Puro.
 * El coach arranca después de la lectura del agente de perfil (`/cv/perfil`) y usa su ticket (`flowId`):
 * no hay ticket propio. Solo vive en `(app)`: no es un paso del onboarding.
 */

export const CV_COACH_PAGES = {
  diagnosis: "/cv/coach",
  chat: "/cv/coach/charla",
  done: "/cv/coach/listo",
} as const;
export type CvCoachPage = keyof typeof CV_COACH_PAGES;

/** Un endpoint por paso. R12-10 crea los dos; el cierre reusa `/api/cv-perfil/cierre` (ADR-034). */
export const CV_COACH_API = {
  diagnosis: "/api/cv-coach/diagnostico",
  turn: "/api/cv-coach/turno",
} as const;

/**
 * `sessionStorage` (por pestaña), nunca `localStorage`. Si faltan o no validan, la página vuelve al
 * diagnóstico (o a la lectura si tampoco hay ticket del agente de perfil).
 * - `issues`: la lista de problemas firmada (`cvCoachSignedIssuesSchema`): el servidor verifica la firma.
 * - `state`: el avance de la charla (`cvCoachStateSchema`): no tiene dónde llevar el CV ni la charla.
 * - `before`: la foto «antes» para «Qué mejoró» (`cvCoachBeforeSchema`, ADR-038 §8).
 */
export const CV_COACH_STORAGE_KEYS = {
  issues: "jso:coach:issues",
  state: "jso:coach:state",
  before: "jso:coach:before",
} as const;
