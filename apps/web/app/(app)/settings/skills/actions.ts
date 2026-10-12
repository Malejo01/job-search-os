"use server";

import { parseRemoveSlugs, parseSkillLevelsForm } from "@job-search-os/pipeline";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { scheduleMarketRecompute } from "@/lib/market-recompute";
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
 * falla vuelve con el nombre del campo, nunca con el valor. El usuario sale de la sesión. Después
 * programa el recálculo de mercado y plan, que corre sin que la persona espere.
 */
export async function saveSkillsAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const parsed = parseSkillLevelsForm(formToRaw(formData));
  if (!parsed.ok) redirect(`${BACK}?error=${encodeURIComponent(parsed.field)}`);
  const remove = parseRemoveSlugs(formData.getAll("quitar").filter((v) => typeof v === "string"));
  const { changed } = await saveSkillLevels(userId, parsed.entries, remove);
  if (changed > 0) scheduleMarketRecompute(userId, { inputsChanged: true });
  revalidatePath(BACK);
  redirect(`${BACK}?guardado=1`);
}
