"use server";

import { parseRemoveSlugs, parseSkillLevelsForm } from "@job-search-os/pipeline";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { FormActionError } from "@/app/components/guarded-form";
import { scheduleMarketRecompute } from "@/lib/market-recompute";
import { reassignForSkills, scheduleImmediateEvaluation } from "@/lib/pool-reassign";
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
 * falla devuelve `{ ok: false, field }` (nunca el valor) y el formulario conserva lo cargado. El
 * usuario sale de la sesión. Los puestos no cambian acá (ronda 45): se cambian en Ajustes.
 * Después programa el recálculo de mercado y plan, que corre sin que la persona espere.
 */
export async function saveSkillsAction(formData: FormData): Promise<FormActionError | void> {
  const userId = await requireUserId();
  const parsed = parseSkillLevelsForm(formToRaw(formData));
  if (!parsed.ok) return { ok: false, field: parsed.field };
  const remove = parseRemoveSlugs(formData.getAll("quitar").filter((v) => typeof v === "string"));
  const { changed } = await saveSkillLevels(userId, parsed.entries, remove);
  if (changed > 0) scheduleMarketRecompute(userId, { inputsChanged: true });
  // Reasignación del pool (ronda 41): niveles nuevos solo actúan si la persona nunca evaluó nada
  // del pool. Sincrónico; la evaluación inmediata es solo la de la primera vez.
  if (changed > 0) {
    const result = await reassignForSkills(userId);
    if (result.firstTime) scheduleImmediateEvaluation(userId, result.enqueuedJobIds);
  }
  revalidatePath(BACK);
  redirect(`${BACK}?guardado=1`);
}
