/**
 * Cómo se guarda lo que salió del chat (C-25): una entrada que coincide con una ya cargada (mismo tipo,
 * empresa, cargo e inicio) la actualiza; el resto se suma, con el tope de 20 entradas por persona. Puro.
 */
import { CV_MAX_HISTORY_ENTRIES, type CvHistoryInput } from "../cv-out/model";
import { foldCvText } from "../cv-out/verify";

export type CvStoredEntry = CvHistoryInput & { id: string };

export interface CvHistoryMerge {
  updates: { id: string; entry: CvHistoryInput }[];
  inserts: CvHistoryInput[];
  /** Entradas que no entraron por el tope de 20. */
  overflow: number;
}

const keyOf = (e: CvHistoryInput): string =>
  [e.kind, foldCvText(e.organization), foldCvText(e.title), e.startMonth ?? ""].join("|");

export function mergeChatHistory(
  existing: readonly CvStoredEntry[],
  incoming: readonly CvHistoryInput[],
): CvHistoryMerge {
  const byKey = new Map(existing.map((e) => [keyOf(e), e.id]));
  const updates: CvHistoryMerge["updates"] = [];
  const inserts: CvHistoryInput[] = [];
  const seen = new Set<string>();
  let overflow = 0;
  for (const entry of incoming) {
    const key = keyOf(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    const id = byKey.get(key);
    if (id) {
      updates.push({ id, entry });
    } else if (existing.length + inserts.length < CV_MAX_HISTORY_ENTRIES) {
      inserts.push(entry);
    } else {
      overflow++;
    }
  }
  return { updates, inserts, overflow };
}

/** El historial como quedaría después de guardar: lo que la vista previa muestra antes de confirmar. */
export function applyChatMerge(
  existing: readonly CvStoredEntry[],
  merge: CvHistoryMerge,
): CvHistoryInput[] {
  const updated = new Map(merge.updates.map((u) => [u.id, u.entry]));
  return [...existing.map((e) => updated.get(e.id) ?? e), ...merge.inserts];
}
