/**
 * Textos de la pantalla `/recorrido` (R26-03) y del campo de sugerencia del feedback (R26-04). Van acá y
 * no en `textos-rediseno.ts`: ese archivo lo aprueba Ani. Sin imports: lo leen servidor y cliente.
 */
export const RECORRIDO_TEXTOS = {
  title: "Recorrido para revisar",
  intro:
    "Una lista de las pantallas para mirar con calma. Cada una dice qué es y tres cosas para fijarte. Abrila con tus datos y, si algo no te cierra, comentá esa pantalla.",
  /** «Revisaste 5 de 18» */
  progress: (done: number, total: number) => `Revisaste ${done} de ${total}`,
  look: "Qué mirar",
  open: "Abrir",
  comment: "Comentar esta pantalla",
  reviewed: "Ya la revisé",
  resetProgress: "Empezar de cero",
  noDataTitle: "Para abrir esta pantalla hace falta algo antes",
  /** Aviso cuando el navegador no deja guardar el progreso */
  noStorage: "Este navegador no guarda lo que marcás: el avance se pierde al cerrar la página.",
  menuLink: "Recorrido para revisar",
  menuHint: "Las pantallas para mirar, con qué fijarte en cada una",
  textosLink: "Revisar los textos",
  textosHint: "Aprobá o proponé otro para los textos nuevos de la app",
} as const;

export const FEEDBACK_SUGGESTION_TEXTOS = {
  label: "¿Qué te gustaría que cambie?",
  optional: "(opcional)",
  /** Aviso del diálogo cuando se abrió desde «Comentar esta pantalla» */
  screenNote: (label: string) => `Estás comentando: ${label}`,
  errorSuggestion:
    "La sugerencia es muy larga, o entre el mensaje y la sugerencia pasan el máximo. Acortá alguna de las dos.",
} as const;
