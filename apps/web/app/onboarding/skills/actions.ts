"use server";

import { parseRemoveSlugs, parseSkillLevelsForm } from "@job-search-os/pipeline";
import { redirect } from "next/navigation";
import { scheduleMarketRecompute } from "@/lib/market-recompute";
import { isOnboardingComplete, setTargetRole } from "@/lib/onboarding";
import {
  reassignForRoleChange,
  reassignForSkills,
  scheduleImmediateEvaluation,
} from "@/lib/pool-reassign";
import { requireUserId } from "@/lib/session";
import { saveSkillLevels } from "@/lib/skill-levels";

/**
 * Paso opcional del onboarding: guarda los niveles y sigue a «Tus primeras ofertas». Misma validación que
 * Ajustes; si falla vuelve con el nombre del campo, nunca con el valor.
 */
export async function saveOnboardingSkillsAction(
  chosenRole: string | null,
  formData: FormData,
): Promise<void> {
  const userId = await requireUserId();
  if (!(await isOnboardingComplete(userId))) redirect("/onboarding");
  // «Saltear por ahora» es un botón del mismo formulario: no guarda niveles, pero sí el rol elegido
  const skip = formData.get("saltear") !== null;
  let roleChanged = false;
  if (!skip) {
    const raw: Record<string, string> = {};
    for (const [k, v] of formData.entries()) if (typeof v === "string") raw[k] = v;
    const parsed = parseSkillLevelsForm(raw);
    if (!parsed.ok) redirect(`/onboarding/skills?error=${encodeURIComponent(parsed.field)}`);
    // El rol elegido en esta pantalla (`?rol=`) reemplaza al del paso 1; se valida en el servidor
    if (chosenRole !== null) roleChanged = (await setTargetRole(userId, chosenRole)).changed;
    const remove = parseRemoveSlugs(formData.getAll("quitar").filter((v) => typeof v === "string"));
    const { changed } = await saveSkillLevels(userId, parsed.entries, remove);
    if (changed > 0) scheduleMarketRecompute(userId, { inputsChanged: true });
  } else if (chosenRole !== null) {
    roleChanged = (await setTargetRole(userId, chosenRole)).changed;
  }
  // Primera evaluación (ronda 41): con lo que ya cargó, reemplaza las ofertas no tocadas del paso 1
  // y asigna con el tope de la primera vez. Sincrónico, antes del redirect, para que «Tus primeras
  // ofertas» ya muestre las nuevas; la evaluación inmediata corre después, en after().
  // Si cambió el puesto, `reassignForRoleChange` sin actividad delega en `reassignForSkills`.
  const result = roleChanged
    ? await reassignForRoleChange(userId)
    : await reassignForSkills(userId);
  if (result.firstTime) scheduleImmediateEvaluation(userId, result.enqueuedJobIds);
  redirect("/onboarding/ofertas");
}
