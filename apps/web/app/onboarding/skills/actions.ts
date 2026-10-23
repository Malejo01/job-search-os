"use server";

import { redirect } from "next/navigation";
import type { FormActionError } from "@/app/components/guarded-form";
import { saveSkillsFromForm } from "@/app/(app)/settings/skills/save-skills";
import { scheduleMarketRecompute } from "@/lib/market-recompute";
import { isOnboardingComplete } from "@/lib/onboarding";
import { reassignForSkills, scheduleImmediateEvaluation } from "@/lib/pool-reassign";
import { requireTermsAcceptedUserId } from "@/lib/session";

/**
 * Paso opcional del onboarding: guarda los niveles, el inglés (CEFR) y las skills propias, y sigue a
 * «Tus primeras ofertas». Misma validación que Ajustes; si falla devuelve el nombre del campo (nunca
 * el valor) y el formulario no pierde nada. «Saltear por ahora» no toca nada, tampoco el inglés. Los
 * puestos no cambian acá (ronda 45): los pills de la pantalla solo muestran sugerencias de skills.
 */
export async function saveOnboardingSkillsAction(
  formData: FormData,
): Promise<FormActionError | void> {
  const userId = await requireTermsAcceptedUserId();
  if (!(await isOnboardingComplete(userId))) redirect("/onboarding");
  // «Saltear por ahora» es un botón del mismo formulario: no guarda niveles
  const skip = formData.get("saltear") !== null;
  if (!skip) {
    const saved = await saveSkillsFromForm(userId, formData);
    if (!saved.ok) return { ok: false, field: saved.field };
    if (saved.changed > 0) scheduleMarketRecompute(userId, { inputsChanged: true });
  }
  // Primera evaluación (ronda 41): con lo que ya cargó, reemplaza las ofertas no tocadas del paso 1
  // y asigna con el tope de la primera vez. Sincrónico, antes del redirect, para que «Tus primeras
  // ofertas» ya muestre las nuevas; la evaluación inmediata corre después, en after().
  const result = await reassignForSkills(userId);
  if (result.firstTime) scheduleImmediateEvaluation(userId, result.enqueuedJobIds);
  redirect("/onboarding/ofertas");
}
