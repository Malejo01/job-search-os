/**
 * Acuse y contradicción del coach de CV, armados por el código (ADR-038 §5). Puro. No hay texto del modelo:
 * el acuse sale de las tarjetas ya verificadas (y de los datos confirmados del CV), así que puede llevar
 * años («Anoté Empresa A, Analista, abril de 2025 a marzo de 2026»). La regla «acuse sin dígitos» de
 * ADR-026 §2 es para texto del modelo y sigue valiendo para `safeCvAck`.
 */
import { cleanCvText } from "../../cv-out/verify";
import type { CoachConflict, CvCoachCard } from "./cards";
import type { CvCoachTurnContext } from "./context";
import { formatCoachRange } from "./months";

export const COACH_ACK_MAX_CHARS = 300;
export const COACH_ACK_DECLINED = "Entendido, lo dejamos así y seguimos.";
export const COACH_ACK_UNREADABLE = "No llegué a entender bien tu respuesta.";
export const COACH_ACK_CHOICE: Record<0 | 1, string> = {
  0: "Listo, queda lo que figura en tu CV.",
  1: "Listo, lo cambio por lo que me dijiste.",
};

const COUNT_WORDS = ["", "una", "dos", "tres", "cuatro"];
const NEW_ITEM_LABELS = {
  trabajo: "un trabajo nuevo",
  proyecto: "un proyecto nuevo",
  educacion: "un estudio nuevo",
} as const;

const countWord = (n: number): string => COUNT_WORDS[n] ?? String(n);

function bulletsLabel(n: number): string {
  return n === 1 ? "una viñeta nueva" : `${countWord(n)} viñetas nuevas`;
}

/**
 * «Anoté Empresa A, Analista, abril de 2025 a marzo de 2026; Proyecto 2, el link.» `null` si no hay
 * tarjetas. Agrupa por ítem en el orden en que salieron las tarjetas.
 */
export function coachAck(cards: readonly CvCoachCard[], ctx: CvCoachTurnContext): string | null {
  if (cards.length === 0) return null;
  const groups = new Map<string, { head: string; parts: string[] }>();
  const loose: string[] = [];
  let notes = 0;
  for (const card of cards) {
    if (card.kind === "new_item") {
      loose.push(NEW_ITEM_LABELS[card.itemKind]);
      continue;
    }
    if (card.kind === "note" || card.historyId === null) {
      if (card.kind === "stack") loose.push(`las herramientas ${card.stack.join(", ")}`);
      else notes++;
      continue;
    }
    const item = ctx.items.find((i) => i.id === card.historyId);
    const id = card.historyId;
    const g = groups.get(id) ?? { head: item?.organization ?? "", parts: [] };
    groups.set(id, g);
    switch (card.kind) {
      case "names":
        if (card.organization !== null) g.head = card.organization;
        if (card.title !== null) g.parts.push(card.title);
        break;
      case "dates": {
        const range = formatCoachRange(card);
        if (range) g.parts.push(range);
        break;
      }
      case "bullets":
        g.parts.push(bulletsLabel(card.bullets.length));
        break;
      case "link":
        g.parts.push("el link");
        break;
      case "stack":
        g.parts.push(`las herramientas ${card.stack.join(", ")}`);
        break;
    }
  }
  const chunks = [...groups.values()].map((g) => [g.head, ...g.parts].filter(Boolean).join(", "));
  if (notes > 0)
    loose.push(notes === 1 ? "una nota para revisar" : `${countWord(notes)} notas para revisar`);
  const all = [...chunks, ...loose].filter((c) => c !== "");
  if (all.length === 0) return null;
  return cleanCvText(`Anoté ${all.join("; ")}.`, COACH_ACK_MAX_CHARS, false);
}

export type CoachConflictQuestion = {
  cardKey: string;
  text: string;
  /** 0 = dejar lo del CV; 1 = cambiar por lo que dijo (`cvCoachAnswerSchema`, `choice`). */
  options: [string, string];
};

/** «En tu CV figura febrero de 2025, acá me decís marzo de 2025. ¿Cuál dejo?» Sin modelo. */
export function coachConflictQuestion(c: CoachConflict): CoachConflictQuestion {
  const before = cleanCvText(c.before, 120, false);
  const after = cleanCvText(c.after, 120, false);
  return {
    cardKey: c.cardKey,
    text: `En tu CV figura ${before}, acá me decís ${after}. ¿Cuál dejo?`,
    options: [before, after],
  };
}
