import { INTERVIEW_SENIORITY_LABELS, type InterviewScoreLevel } from "@job-search-os/pipeline";
import { INTERVIEW_SCORE_WORDS } from "../../../lib/textos-rediseno";

/**
 * Textos del simulador de entrevistas. Voz de `docs/MARCA.md`: claros y serenos, sin onda cuando algo falla,
 * y sin prometer resultados. Los mensajes de error son fijos: nunca el texto del modelo ni de una excepción.
 */
export const SENIORITY_OPTIONS = Object.entries(INTERVIEW_SENIORITY_LABELS) as [
  keyof typeof INTERVIEW_SENIORITY_LABELS,
  string,
][];

export const CRITERIA = [
  { key: "clarity", label: "Claridad" },
  { key: "relevance", label: "Relevancia" },
  { key: "star", label: "Estructura STAR" },
] as const;

/**
 * Informe final. Los consejos se agrupan por el criterio donde la respuesta sacó menos (regla fija, sin IA):
 * el texto de cada grupo explica en qué consiste el patrón; el consejo concreto es el del propio modelo.
 */
export const REPORT_PATTERNS = {
  clarity: "Varias respuestas se entendieron con esfuerzo: ordená las ideas y andá al punto.",
  relevance:
    "Varias respuestas se alejaron de lo que preguntaban: volvé a la pregunta antes de cerrar.",
  star: "Varias respuestas no contaron la historia completa: situación, tarea, acción y resultado.",
} as const;

export const scoreWord = (level: InterviewScoreLevel): string => INTERVIEW_SCORE_WORDS[level];

export const START_ERRORS: Record<string, string> = {
  daily_limit:
    "Ya llegaste al máximo de simulaciones de las últimas 24 horas. Volvé más tarde para hacer otra; mientras tanto podés repasar las que ya terminaste.",
  capped:
    "Por hoy se llegó al límite de uso de la práctica. Probá de nuevo más tarde: tus simulaciones anteriores siguen acá.",
  not_found: "No encontramos esa oferta. Elegí otra o practicá con una carrera y un nivel.",
  llm_failed:
    "Ahora no pudimos armar las preguntas. No gastaste ninguna de tus simulaciones del día: probá de nuevo en un rato.",
  unauthorized: "Tu sesión venció. Volvé a entrar para practicar.",
  bad_request: "Revisá lo que elegiste y probá de nuevo.",
  server: "No pudimos completar el pedido. Probá de nuevo en un rato.",
};

export const ANSWER_ERRORS: Record<string, string> = {
  empty: "Escribí tu respuesta antes de enviarla.",
  too_short:
    "Contanos un poco más: con una o dos palabras no alcanza para darte una devolución útil.",
  finished: "Esta simulación ya terminó. Podés ver tu resumen.",
  capped:
    "Por hoy se llegó al límite de uso de la práctica. Tu respuesta sigue acá: probá de nuevo más tarde.",
  busy: "Todavía estamos con tu respuesta anterior. Esperá unos segundos y volvé a enviarla.",
  llm_failed:
    "Ahora no pudimos evaluar tu respuesta. Tu texto sigue acá: probá de nuevo en un rato.",
  not_found: "No encontramos esta simulación.",
  unauthorized: "Tu sesión venció. Volvé a entrar para seguir practicando.",
  bad_request: "No entendimos el pedido. Recargá la página e intentá de nuevo.",
  server: "No pudimos completar el pedido. Tu texto sigue acá: probá de nuevo en un rato.",
};

/** Promedio con coma decimal, como el resto de los puntajes de la app: «7,4». */
export const formatAverage = (value: number): string =>
  Number.isInteger(value) ? String(value) : value.toFixed(1).replace(".", ",");
