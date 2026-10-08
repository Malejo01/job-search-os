"use server";

import { parseCriteriaForm, type CriteriaFormRaw } from "@job-search-os/pipeline";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getActiveCriteria, resetCriteriaToDefaults, saveCriteria } from "@/lib/criteria";
import { requireUserId } from "@/lib/session";

const BACK = "/settings/criteria";

function baseVersionOf(formData: FormData): number | undefined {
  const v = String(formData.get("baseVersion") ?? "");
  return /^\d{1,9}$/.test(v) ? Number(v) : undefined;
}

/**
 * Guarda el formulario de criterios (JS-096). Valida con Zod en el servidor (parseCriteriaForm);
 * si falla vuelve con el nombre del campo, nunca con el valor. Lo que el formulario no edita se
 * copia de la versión vigente, y la versión que el usuario estaba viendo viaja como `baseVersion`
 * para no pisar un guardado más nuevo.
 */
export async function saveCriteriaAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const baseVersion = baseVersionOf(formData);
  const active = await getActiveCriteria(userId);
  if (!active || baseVersion === undefined) redirect(`${BACK}?error=conflict`);

  const raw: CriteriaFormRaw = {};
  for (const key of formData.keys()) {
    if (key in raw) continue;
    const values = formData.getAll(key).filter((v): v is string => typeof v === "string");
    raw[key] = key === "allowed_disciplines" ? values : values[0];
  }
  const parsed = parseCriteriaForm(raw, active.rules);
  if (!parsed.ok) redirect(`${BACK}?error=${encodeURIComponent(parsed.field)}`);

  const saved = await saveCriteria(userId, parsed.rules, baseVersion);
  revalidatePath(BACK);
  redirect(saved.ok ? `${BACK}?saved=1` : `${BACK}?error=conflict`);
}

/**
 * Segundo paso del reinicio. La confirmación en dos pasos es UX; la integridad la dan la sesión
 * (el usuario sale de ella) y la versión base (sin ella o desactualizada, no se guarda).
 */
export async function resetCriteriaAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const baseVersion = baseVersionOf(formData);
  if (baseVersion === undefined) redirect(`${BACK}?error=conflict`);
  const saved = await resetCriteriaToDefaults(userId, baseVersion);
  revalidatePath(BACK);
  redirect(saved.ok ? `${BACK}?saved=reset` : `${BACK}?error=conflict`);
}
