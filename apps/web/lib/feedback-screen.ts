/**
 * Abrir el feedback con la pantalla ya elegida (R26-03/R26-04). `FeedbackButton` (en el layout) escucha este
 * evento; quien quiere comentar una pantalla que no es la actual (por ejemplo, «Comentar esta pantalla» en
 * `/recorrido`) lo dispara con la ruta del árbol y un nombre para mostrar. Sin imports: lo cargan dos
 * componentes de cliente y no debe sumar peso.
 */
export const FEEDBACK_OPEN_EVENT = "jso:abrir-feedback";

export type FeedbackOpenDetail = {
  /** Ruta del árbol de `app/`, por ejemplo `/jobs/[id]`; es lo que se guarda como pantalla. */
  screen: string;
  /** Cómo se llama la pantalla para quien comenta, por ejemplo «Transparencia del aviso». */
  label: string;
};

export function openFeedbackForScreen(detail: FeedbackOpenDetail): void {
  window.dispatchEvent(new CustomEvent<FeedbackOpenDetail>(FEEDBACK_OPEN_EVENT, { detail }));
}

/** Lee el detalle de un evento sin fiarse de su forma: si no tiene ruta con barra, no se usa. */
export function parseFeedbackOpenDetail(event: Event): FeedbackOpenDetail | null {
  const d = (event as CustomEvent<unknown>).detail;
  if (!d || typeof d !== "object") return null;
  const { screen, label } = d as Record<string, unknown>;
  if (typeof screen !== "string" || !screen.startsWith("/") || screen.length > 200) return null;
  return { screen, label: typeof label === "string" ? label.slice(0, 80) : screen };
}
