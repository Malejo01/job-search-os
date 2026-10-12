"use server";

import { parseRemoveSlugs, parseSkillLevelsForm } from "@job-search-os/pipeline";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { scheduleMarketRecompute } from "@/lib/market-recompute";
import { setTargetRole } from "@/lib/onboarding";
import {
  reassignForRoleChange,
  reassignForSkills,
  scheduleImmediateEvaluation,
} from "@/lib/pool-reassign";
import { requireUserId } from "@/lib/session";
import { saveSkillLevels } from "@/lib/skill-levels";

const BACK = "/settings/skills";

/** Campos del formulario como strings; los archivos no entran. */
function formToRaw(formData: FormData): Record<string, string> {
  const raw: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (typeof v === "string") raw[k] = v;
  return raw;
}

/**
 * Guarda los niveles autodeclarados. Valida con Zod en el servidor (parseSkillLevelsForm); si
 * falla vuelve con el nombre del campo, nunca con el valor. El usuario sale de la sesión. Si la
 * pantalla tenía un rol elegido a mano, lo guarda como rol objetivo (`chosenRole`, ya atado desde
 * la página con `bind`; se valida acá igual). Después
 * programa el recálculo de mercado y plan, que corre sin que la persona espere.
 */
export async function saveSkillsAction(
  chosenRole: string | null,
  formData: FormData,
): Promise<void> {
  const userId = await requireUserId();
  const parsed = parseSkillLevelsForm(formToRaw(formData));
  if (!parsed.ok) redirect(`${BACK}?error=${encodeURIComponent(parsed.field)}`);
  // El rol elegido en la pantalla (`?rol=`) pasa a ser el rol objetivo; se valida en el servidor
  const roleChanged = chosenRole !== null && (await setTargetRole(userId, chosenRole)).changed;
  const remove = parseRemoveSlugs(formData.getAll("quitar").filter((v) => typeof v === "string"));
  const { changed } = await saveSkillLevels(userId, parsed.entries, remove);
  if (changed > 0) scheduleMarketRecompute(userId, { inputsChanged: true });
  // Reasignación del pool (ronda 41): un puesto nuevo reasigna siempre; solo niveles nuevos solo
  // actúan si la persona nunca evaluó nada del pool. Sincrónico; la evaluación inmediata es solo
  // la de la primera vez.
  if (roleChanged || changed > 0) {
    const result = roleChanged
      ? await reassignForRoleChange(userId)
      : await reassignForSkills(userId);
    if (result.firstTime) scheduleImmediateEvaluation(userId, result.enqueuedJobIds);
  }
  revalidatePath(BACK);
  redirect(`${BACK}?guardado=1`);
}
