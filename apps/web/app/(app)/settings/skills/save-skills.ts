import {
  ENGLISH_SKILL_SLUGS,
  type CefrLevel,
  isEnglishSkillSlug,
  parseCustomSkillsForm,
  parseEnglishCefr,
  parseRemoveCustomIds,
  parseRemoveSlugs,
  parseSkillLevelsForm,
} from "@job-search-os/pipeline";
import {
  englishSkillEntries,
  getSkillsSaveContext,
  saveCustomSkills,
  saveEnglishCefr,
  saveSkillLevels,
} from "@/lib/skill-levels";

/**
 * Guarda el formulario de skills de ajustes y del onboarding (misma lógica en los dos): niveles de la
 * taxonomía, inglés (CEFR) y skills propias. Valida TODO antes de escribir: si algo falla devuelve el
 * campo (nunca el valor) y no se guarda nada. Las dos skills de inglés no vienen como filas: se
 * derivan del CEFR cuando cambia o cuando todavía no tienen nivel. Las skills propias (`user_skills`) no entran a la taxonomía global ni a ningún
 * prompt; por eso no cuentan para el recálculo del mercado (`changed` es solo de la taxonomía).
 */
export async function saveSkillsFromForm(
  userId: string,
  formData: FormData,
): Promise<{ ok: false; field: string } | { ok: true; changed: number }> {
  const raw: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (typeof v === "string") raw[k] = v;

  const levels = parseSkillLevelsForm(raw);
  if (!levels.ok) return { ok: false, field: levels.field };
  const english = parseEnglishCefr(raw.englishCefr);
  if (!english.ok) return { ok: false, field: "englishCefr" };

  const removeSlugs = parseRemoveSlugs(
    formData.getAll("quitar").filter((v): v is string => typeof v === "string"),
  );
  const removeCustom = parseRemoveCustomIds(
    formData.getAll("quitar_propia").filter((v): v is string => typeof v === "string"),
  );
  const context = await getSkillsSaveContext(userId);
  const custom = parseCustomSkillsForm(raw, {
    taxonomy: context.taxonomy,
    existing: context.existing,
    remove: removeCustom,
  });
  if (!custom.ok) return { ok: false, field: custom.field };

  // El inglés se deriva del CEFR: una fila `level:english_*` armada a mano no cuenta. Se deriva
  // cuando el CEFR cambió o todavía no hay niveles; si no, se respetan los que ya tiene (pueden
  // venir de evidencia o de una carga anterior).
  const entries = levels.entries.filter((e) => !isEnglishSkillSlug(e.slug));
  let deriveCefr: CefrLevel | null = null;
  if (english.cefr) {
    const missing = ENGLISH_SKILL_SLUGS.some((slug) => !(slug in context.englishLevels));
    if (english.cefr !== context.englishCefr || missing) {
      deriveCefr = english.cefr;
      entries.push(...englishSkillEntries(english.cefr));
    }
  }

  // Primero lo que puede rechazarse (el tope de skills propias se recuenta con lock), después los
  // niveles y al final el CEFR del perfil: si algo falla en el medio, el CEFR sigue distinto y el
  // próximo guardado vuelve a derivar el inglés.
  const saved = await saveCustomSkills(userId, {
    updates: custom.updates,
    additions: custom.additions,
    removeIds: removeCustom,
  });
  if (saved.capExceeded) return { ok: false, field: "custom_max" };
  const { changed } = await saveSkillLevels(userId, entries, removeSlugs);
  if (deriveCefr) await saveEnglishCefr(userId, deriveCefr);
  return { ok: true, changed };
}
