import { randomBytes } from "node:crypto";

/** Tope duro de cada paso del chat de CV (entrevista o redacción): 50 s en total, con respaldo incluido. */
export const CV_CHAT_DEADLINE_MS = 50_000;

/** Id aleatorio de una charla. No se guarda la conversación: solo viaja en `llm_calls.label`. */
export function newCvConversationId(): string {
  return randomBytes(6).toString("hex");
}

/** `cv:<id>`: lo que cuenta el gasto de la charla y los CV del mes. */
export function cvChatLabel(conversationId: string): string {
  return `cv:${conversationId}`;
}

/** Señal que vence a los 50 s y respeta la cancelación externa. */
export function cvChatSignal(
  external?: AbortSignal,
  ms: number = CV_CHAT_DEADLINE_MS,
): AbortSignal {
  const deadline = AbortSignal.timeout(ms);
  return external ? AbortSignal.any([external, deadline]) : deadline;
}
