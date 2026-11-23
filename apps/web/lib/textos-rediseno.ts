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

/** Nivel de un ítem del diagnóstico del CV cuando el mercado del puesto tiene pocos avisos: sin puntaje. */
export const CV_NOT_ENOUGH_DATA_LABEL = "Sin datos suficientes";

/** Recorrido de primer uso tras el rediseño (R23-05): cuatro pasos cortos, sin promesas. */
export const PRIMER_USO = {
  label: "Lo nuevo de AfinIAJobs",
  next: "Siguiente",
  back: "Anterior",
  skip: "Saltar",
  done: "Listo",
  steps: [
    {
      id: "menu",
      title: "El menú cambió",
      text: "Arriba (o abajo, en el celular) tenés cinco secciones: Hoy, Match, CV, Tracker e Interview. Lo demás, como Academy, Perfil y Ajustes, está en «Más», dentro de tu avatar.",
    },
    {
      id: "interview",
      title: "Practicá una entrevista",
      text: "En Interview elegís una oferta y respondés cinco preguntas. Después de cada respuesta ves una devolución con puntajes y consejos.",
    },
    {
      id: "sello",
      title: "El sello tiene detalle",
      text: "En cada oferta, abrí el detalle del sello para ver una barra por criterio. No cambia el número: te explica de dónde sale.",
    },
    {
      id: "academy",
      title: "Academy",
      text: "Fichas cortas para entender los términos que aparecen en la app. También las abrís desde los «?» que ves al lado de cada término.",
    },
  ],
} as const;

/** Texto para una condición laboral que el aviso no dice. */
export const NOT_INFORMED_LABEL = "No lo informa";
