import type { ChecklistItem } from "../evaluator/checklist";
import { applyRequirementAnswers, type RequirementAnswer } from "../requirements/card-rows";
import { withCurrentProfileFacts, type CurrentProfileFacts } from "../requirements/profile-overlay";
import { summarizeRequirements, type RequirementCode } from "../requirements/summary";

/**
 * Lo que la tarjeta dice sobre requisitos (R30-04), siempre desde la tabla de requisitos. La lista
 * trae solo las filas que no coinciden (más livianas que el checklist entero): alcanza con estos campos.
 */
export type CardChecklistItem = Pick<
  ChecklistItem,
  "id" | "kind" | "nivel" | "status" | "bloquea" | "tenes" | "pide"
> & {
  /** R31-07: la fila del aviso que ofrece la pregunta de un toque (solo la clave se usa acá). */
  pregunta?: { clave: string };
};

/**
 * R31-07: la tarjeta lee la tabla guardada; para que no quede atrasada respecto del detalle, se le
 * superponen (sin modelo, sin consultas por oferta) el inglés y los años de hoy y las respuestas de
 * un toque de la persona. Mismas funciones puras que el detalle.
 */
export function cardItemsNow(
  items: readonly CardChecklistItem[],
  ctx: { answers?: ReadonlyMap<string, RequirementAnswer>; facts?: CurrentProfileFacts },
): readonly CardChecklistItem[] {
  if (!items.length || (!ctx.answers && !ctx.facts)) return items;
  const full = items.map((i) => ({
    evidencia: null,
    fuente: { pide: "fuente", tenes: null },
    ...i,
    ...(i.pregunta ? { pregunta: { clave: i.pregunta.clave, respuesta: null, nota: null } } : {}),
  })) as ChecklistItem[];
  const zero = { cumple: 0, no_cumple: 0, no_se_sabe: 0 };
  let table = { items: full, must: zero, deseable: zero };
  if (ctx.facts) table = withCurrentProfileFacts(table, ctx.facts);
  if (ctx.answers) table = applyRequirementAnswers(table, ctx.answers);
  return table.items.map((i, n) => ({
    id: i.id,
    kind: i.kind,
    nivel: i.nivel,
    status: i.status,
    bloquea: i.bloquea,
    tenes: i.tenes,
    pide: i.pide,
    ...(items[n]?.pregunta ? { pregunta: items[n]!.pregunta } : {}),
  }));
}

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
