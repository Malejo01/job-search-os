import { isEnglishSkillSlug } from "../skills/english";
import { parseSkillLevelsForm, type SkillLevelEntry } from "../skills/self-assessment";
import type { ChecklistItem } from "./checklist";

/**
 * Nivel de una skill cargado desde el detalle de una oferta (C-20). Puro: la app lee los niveles y
 * pasa los datos. `decision.checklist` es una foto del momento de la evaluación; para que el ítem
 * muestre el nivel recién cargado sin evaluar de nuevo (sin LLM) se superponen los niveles actuales
 * al renderizar. El titular «X de Y» no cambia: las skills nombradas no entran en él.
 */

/** Mismo criterio que `buildChecklist`: desde el nivel 2 la skill cuenta como «cumple». */
const statusFor = (level: number): ChecklistItem["status"] => (level >= 2 ? "cumple" : "no_cumple");

export function withCurrentSkillLevels<C extends { items: ChecklistItem[] }>(
  checklist: C,
  levels: ReadonlyMap<string, number>,
): C {
  if (levels.size === 0) return checklist;
  const items = checklist.items.map((it): ChecklistItem => {
    if (!it.id.startsWith("skill:")) return it;
    const level = levels.get(it.id.slice("skill:".length));
    if (level === undefined || !Number.isInteger(level) || level < 0 || level > 3) return it;
    return {
      ...it,
      tenes: `Nivel ${level} de 3`,
      status: statusFor(level),
      fuente: { ...it.fuente, tenes: "skills" },
    };
  });
  return { ...checklist, items };
}

export type SingleSkillLevelParse =
  { ok: true; entry: SkillLevelEntry } | { ok: false; field: "slug" | "level" };

/**
 * Valida el pedido de la acción del modal: `slug` de la taxonomía (y no de inglés, que se carga por
 * CEFR en Ajustes) y `level` entero de 0 a 3. Devuelve el campo que falla, nunca el valor.
 */
export function parseSingleSkillLevel(
  input: unknown,
  taxonomySlugs: readonly string[],
): SingleSkillLevelParse {
  const raw = (input ?? {}) as { slug?: unknown; level?: unknown };
  if (typeof raw.slug !== "string") return { ok: false, field: "slug" };
  if (typeof raw.level !== "number" || !Number.isInteger(raw.level)) {
    return { ok: false, field: "level" };
  }
  const parsed = parseSkillLevelsForm({ [`level:${raw.slug}`]: String(raw.level) });
  if (!parsed.ok) return { ok: false, field: parsed.field === "slug" ? "slug" : "level" };
  const entry = parsed.entries[0];
  if (!entry) return { ok: false, field: "level" };
  if (isEnglishSkillSlug(entry.slug) || !taxonomySlugs.includes(entry.slug)) {
    return { ok: false, field: "slug" };
  }
  return { ok: true, entry };
}
