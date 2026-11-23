import { INTERVIEW_SENIORITY_LABELS } from "@job-search-os/pipeline";

// R23-09: lo que usa el simulador vive en `copy-cliente.ts`; se re-exporta para no cambiar a los importadores
export * from "./copy-cliente";

/**
 * Textos del simulador de entrevistas que solo usa el servidor o las pantallas de la lista. Voz de
 * `docs/MARCA.md`: claros y serenos, sin onda cuando algo falla, y sin prometer resultados. Los mensajes
 * de error son fijos: nunca el texto del modelo ni de una excepción.
 */
export const SENIORITY_OPTIONS = Object.entries(INTERVIEW_SENIORITY_LABELS) as [
  keyof typeof INTERVIEW_SENIORITY_LABELS,
  string,
][];

export const DELETE_ERRORS: Record<string, string> = {
  unauthorized: "Tu sesión venció. Volvé a entrar para borrar la simulación.",
  bad_request: "No entendimos el pedido. Recargá la página e intentá de nuevo.",
  server: "No pudimos borrar la simulación. Probá de nuevo en un rato.",
};
