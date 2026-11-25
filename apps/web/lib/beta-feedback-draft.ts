import { isFeedbackCategory } from "@job-search-os/pipeline";

/**
 * Borrador del modal «¿Algo no anduvo?» (R29-01). Vive en `sessionStorage`: sobrevive a cerrar el modal, a un
 * error de envío y a una recarga, y se borra solo al recibir «¡Gracias!». La clave es fija y sin datos de la
 * persona; el valor es lo que la persona escribió. Sin React ni DOM: recibe el almacenamiento para poder
 * probarlo. Falla cerrado: un almacenamiento bloqueado o un contenido raro dan «sin borrador», nunca un error.
 */
export const FEEDBACK_DRAFT_KEY = "jso:feedback-borrador:v1";
/** Un borrador de hace más de 12 horas ya no es de esta sesión de trabajo: se descarta. */
export const FEEDBACK_DRAFT_MAX_AGE_MS = 12 * 3_600_000;

export type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type FeedbackDraft = {
  /** Categoría elegida, o "" si todavía no eligió. */
  category: string;
  message: string;
  suggestion: string;
};

export function serializeFeedbackDraft(draft: FeedbackDraft, now: number): string {
  return JSON.stringify({ v: 1, at: now, ...draft });
}

/** Lee un borrador sin fiarse de su forma. `null` si no hay, está roto o venció. */
export function parseFeedbackDraft(raw: string | null, now: number): FeedbackDraft | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const d = value as Record<string, unknown>;
  if (d.v !== 1 || typeof d.at !== "number") return null;
  if (typeof d.message !== "string" || typeof d.suggestion !== "string") return null;
  if (typeof d.category !== "string") return null;
  if (now - d.at > FEEDBACK_DRAFT_MAX_AGE_MS) return null;
  return {
    category: isFeedbackCategory(d.category) ? d.category : "",
    message: d.message,
    suggestion: d.suggestion,
  };
}

export function readFeedbackDraft(storage: DraftStorage, now: number): FeedbackDraft | null {
  try {
    const raw = storage.getItem(FEEDBACK_DRAFT_KEY);
    const draft = parseFeedbackDraft(raw, now);
    if (raw && !draft) storage.removeItem(FEEDBACK_DRAFT_KEY);
    return draft;
  } catch {
    return null;
  }
}

/** Guarda el borrador; si no hay nada escrito ni elegido, borra el anterior. */
export function writeFeedbackDraft(storage: DraftStorage, draft: FeedbackDraft, now: number): void {
  try {
    const empty = !draft.category && !draft.message.trim() && !draft.suggestion.trim();
    if (empty) storage.removeItem(FEEDBACK_DRAFT_KEY);
    else storage.setItem(FEEDBACK_DRAFT_KEY, serializeFeedbackDraft(draft, now));
  } catch {
    // sessionStorage bloqueado o lleno: el envío sigue funcionando, solo no hay borrador
  }
}

export function clearFeedbackDraft(storage: DraftStorage): void {
  try {
    storage.removeItem(FEEDBACK_DRAFT_KEY);
  } catch {
    // nada que hacer
  }
}
