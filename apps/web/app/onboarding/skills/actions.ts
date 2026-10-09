"use server";

import { parseRemoveSlugs, parseSkillLevelsForm } from "@job-search-os/pipeline";
import { redirect } from "next/navigation";
import { scheduleMarketRecompute } from "@/lib/market-recompute";
import { isOnboardingComplete } from "@/lib/onboarding";
import { requireUserId } from "@/lib/session";
import { saveSkillLevels } from "@/lib/skill-levels";

/**
 * Paso opcional del onboarding: guarda los niveles y sigue al asistente. Misma validación que
 * Ajustes; si falla vuelve con el nombre del campo, nunca con el valor.
 */
export async function saveOnboardingSkillsAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  if (!(await isOnboardingComplete(userId))) redirect("/onboarding");
  const raw: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (typeof v === "string") raw[k] = v;
  const parsed = parseSkillLevelsForm(raw);
  if (!parsed.ok) redirect(`/onboarding/skills?error=${encodeURIComponent(parsed.field)}`);
  const remove = parseRemoveSlugs(formData.getAll("quitar").filter((v) => typeof v === "string"));
  const { changed } = await saveSkillLevels(userId, parsed.entries, remove);
  if (changed > 0) scheduleMarketRecompute(userId, { inputsChanged: true });
  redirect("/onboarding/asistente");
}
