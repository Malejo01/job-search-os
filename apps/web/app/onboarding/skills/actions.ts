"use server";

import { parseRemoveSlugs, parseSkillLevelsForm } from "@job-search-os/pipeline";
import { redirect } from "next/navigation";
import type { FormActionError } from "@/app/components/guarded-form";
import { scheduleMarketRecompute } from "@/lib/market-recompute";
import { isOnboardingComplete } from "@/lib/onboarding";
import { reassignForSkills, scheduleImmediateEvaluation } from "@/lib/pool-reassign";
import { requireUserId } from "@/lib/session";
import { saveSkillLevels } from "@/lib/skill-levels";

/**
 * Paso opcional del onboarding: guarda los niveles y sigue a «Tus primeras ofertas». Misma validación que
 * Ajustes; si falla devuelve el nombre del campo (nunca el valor) y el formulario no pierde nada. Los puestos no cambian acá
 * (ronda 45): los pills de la pantalla solo muestran sugerencias de skills.
 */
export async function saveOnboardingSkillsAction(
  formData: FormData,
): Promise<FormActionError | void> {
  const userId = await requireUserId();
  if (!(await isOnboardingComplete(userId))) redirect("/onboarding");
  // «Saltear por ahora» es un botón del mismo formulario: no guarda niveles
  const skip = formData.get("saltear") !== null;
  if (!skip) {
    const raw: Record<string, string> = {};
    for (const [k, v] of formData.entries()) if (typeof v === "string") raw[k] = v;
    const parsed = parseSkillLevelsForm(raw);
    if (!parsed.ok) return { ok: false, field: parsed.field };
    const remove = parseRemoveSlugs(formData.getAll("quitar").filter((v) => typeof v === "string"));
    const { changed } = await saveSkillLevels(userId, parsed.entries, remove);
    if (changed > 0) scheduleMarketRecompute(userId, { inputsChanged: true });
  }
  // Primera evaluación (ronda 41): con lo que ya cargó, reemplaza las ofertas no tocadas del paso 1
  // y asigna con el tope de la primera vez. Sincrónico, antes del redirect, para que «Tus primeras
  // ofertas» ya muestre las nuevas; la evaluación inmediata corre después, en after().
  const result = await reassignForSkills(userId);
  if (result.firstTime) scheduleImmediateEvaluation(userId, result.enqueuedJobIds);
  redirect("/onboarding/ofertas");
}
