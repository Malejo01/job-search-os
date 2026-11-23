/**
 * Textos de Interview que viajan al cliente (R23-09). Viven en un archivo aparte, y
 * `textos-rediseno.ts` los re-exporta, para que el simulador no arrastre todos los textos del
 * rediseño a su First Load. Para cambiar un texto, se edita acá; los importadores de siempre
 * (`@/lib/textos-rediseno`) no cambian.
 */

/** Palabra de cada puntaje (0 a 10) de la devolución del simulador de entrevistas. */
export const INTERVIEW_SCORE_WORDS = {
  high: "Muy bien",
  mid: "Bien",
  low: "Mejorable",
  far: "A trabajar",
} as const;

/**
 * Interview pulido (R23-08): lo que usa el simulador en el navegador. El vacío y el 404 propio
 * (que solo usa el servidor) están en `INTERVIEW_TEXTOS`, de `textos-rediseno.ts`, que suma estos.
 */
export const INTERVIEW_CLIENTE = {
  analizando: "Analizando tu respuesta…",
  retry: "Reintentar",
} as const;
