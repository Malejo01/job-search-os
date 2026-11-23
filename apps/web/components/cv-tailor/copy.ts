/**
 * Textos de la versión del CV adaptada con IA. Voz de `docs/MARCA.md`: claros y serenos, sin onda cuando algo
 * falla, sin prometer trabajo. Los mensajes de error son fijos: nunca el texto del modelo ni de una excepción.
 * Todos los errores terminan igual: la versión sin IA sigue disponible.
 */
export const TAILOR_TITLE = "Versión adaptada con IA";
export const TAILOR_INTRO =
  "La IA reordena y ajusta el énfasis de tu CV para esta oferta. No agrega experiencias, números ni herramientas que no estén en tu CV: lo verificamos antes de mostrártelo.";
export const TAILOR_LIMIT_NOTE = "Podés pedir hasta 3 por día.";
export const TAILOR_BUTTON = "Armar la versión adaptada";
export const TAILOR_BUTTON_PENDING = "Adaptando tu CV…";
export const TAILOR_VERIFIED_NOTE =
  "Revisamos esta versión contra tu CV: cada dato sale de lo que ya confirmaste.";
export const TAILOR_UNCHANGED =
  "La IA no encontró nada para mover: tu CV ya está bien ordenado para esta oferta.";
export const TAILOR_CHANGES_TITLE = "Qué cambió y por qué";
export const TAILOR_PREVIEW_TITLE = "Cómo queda";

const FALLBACK_TAIL = "Seguís con la versión sin IA, que está lista abajo.";

export const TAILOR_ERRORS: Record<string, string> = {
  daily_limit: `Ya pediste 3 versiones adaptadas en las últimas 24 horas. ${FALLBACK_TAIL}`,
  capped: `Por hoy se llegó al límite de uso de la IA. ${FALLBACK_TAIL}`,
  llm_failed: `Ahora no pudimos armar la versión adaptada. ${FALLBACK_TAIL}`,
  rejected: `La versión que armó la IA traía datos que no están en tu CV, así que la descartamos. ${FALLBACK_TAIL}`,
  no_cv: `Todavía no tenés un CV confirmado para adaptar. ${FALLBACK_TAIL}`,
  empty_cv: `Tu CV todavía no tiene experiencias con viñetas para adaptar. ${FALLBACK_TAIL}`,
  no_job: "No encontramos esa oferta. Recargá la página e intentá de nuevo.",
  off: `La versión adaptada con IA no está disponible para tu cuenta. ${FALLBACK_TAIL}`,
  unauthorized: "Tu sesión venció. Volvé a entrar para seguir.",
  bad_request: "No entendimos el pedido. Recargá la página e intentá de nuevo.",
  server: `No pudimos completar el pedido. ${FALLBACK_TAIL}`,
};
