/**
 * Textos del rediseño que todavía puede cambiar quien define la marca. Todo en un solo lugar: cambiar
 * uno es una línea. Son los valores por defecto hasta la aprobación final.
 */

/** Palabra de una barra de afinidad según su puntaje (0 a 10). */
export const AFFINITY_WORDS = {
  high: "Te calza",
  mid: "Cerca",
  low: "A medias",
  far: "Lejos",
} as const;

/** Palabra de la transparencia del aviso según su puntaje (0 a 10). */
export const TRANSPARENCY_WORDS = {
  clear: "Aviso claro",
  partial: "Le faltan datos",
  opaque: "Aviso opaco",
} as const;

/** Niveles del diagnóstico del CV. */
export const CV_LEVEL_WORDS = {
  good: "Bien",
  improvable: "Mejorable",
  missing: "Falta",
} as const;

/** Palabra de cada puntaje (0 a 10) de la devolución del simulador de entrevistas. */
export const INTERVIEW_SCORE_WORDS = {
  high: "Muy bien",
  mid: "Bien",
  low: "Mejorable",
  far: "A trabajar",
} as const;

/** Título del diagnóstico del CV. */
export const CV_DIAGNOSIS_TITLE = "Cómo lo leen los sistemas de selección";

/** Nombre de la mascota hasta que se elija uno. */
export const MASCOT_NAME = "Tu asistente";

/** Texto para un criterio sin datos: nunca se inventa un puntaje. */
export const NO_DATA_LABEL = "Sin datos";

/** Texto para una condición laboral que el aviso no dice. */
export const NOT_INFORMED_LABEL = "No lo informa";
