import type { ChecklistItem } from "../evaluator/checklist";
import { summarizeRequirements, type RequirementCode } from "../requirements/summary";

/**
 * Lo que la tarjeta dice sobre requisitos (R30-04), siempre desde la tabla de requisitos. La lista
 * trae solo las filas que no coinciden (más livianas que el checklist entero): alcanza con estos campos.
 */
export type CardChecklistItem = Pick<
  ChecklistItem,
  "id" | "kind" | "nivel" | "status" | "bloquea" | "tenes" | "pide"
>;

export type CardRequirement = { code: RequirementCode; pide: string };

export type CardRequirements = {
  /** Condición excluyente que no coincide («No coincide: …»), o null. */
  excluding: CardRequirement | null;
  /** Hasta 2 filas para la línea «Sin confirmar: …». */
  unconfirmed: CardRequirement[];
};

export function cardRequirements(
  items: readonly CardChecklistItem[] | null | undefined,
): CardRequirements {
  if (!items?.length) return { excluding: null, unconfirmed: [] };
  // summarizeRequirements solo lee estos campos; el resto de la fila no se usa acá
  const full = items.map((i) => ({
    evidencia: null,
    fuente: { pide: "fuente", tenes: null },
    ...i,
  }));
  const s = summarizeRequirements({ items: full as ChecklistItem[] });
  const pick = (r: { code: RequirementCode; item: ChecklistItem }): CardRequirement => ({
    code: r.code,
    pide: r.item.pide,
  });
  return {
    excluding: s.blocking ? pick(s.blocking) : null,
    unconfirmed: s.cardUnconfirmed.map(pick),
  };
}
