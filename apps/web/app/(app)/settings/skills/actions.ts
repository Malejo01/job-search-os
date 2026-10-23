"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { FormActionError } from "@/app/components/guarded-form";
import { scheduleMarketRecompute } from "@/lib/market-recompute";
import { reassignForSkills, scheduleImmediateEvaluation } from "@/lib/pool-reassign";
import { requireActiveUserId } from "@/lib/session";
import { saveSkillsFromForm } from "./save-skills";

const BACK = "/settings/skills";

/**
 * Guarda los niveles autodeclarados, el inglés (CEFR) y las skills propias. Valida en el servidor
 * (ver `saveSkillsFromForm`); si falla devuelve `{ ok: false, field }` (nunca el valor) y el
 * formulario conserva lo cargado. El usuario sale de la sesión. Los puestos no cambian acá (ronda
 * 45): se cambian en Ajustes. Después programa el recálculo de mercado y plan, que corre sin que
 * la persona espere.
 */
export async function saveSkillsAction(formData: FormData): Promise<FormActionError | void> {
  const userId = await requireActiveUserId();
  const saved = await saveSkillsFromForm(userId, formData);
  if (!saved.ok) return { ok: false, field: saved.field };
  const { changed } = saved;
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
