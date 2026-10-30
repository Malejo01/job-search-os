"use server";

import { parseCriteriaForm, type CriteriaFormRaw } from "@job-search-os/pipeline";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { FormActionError } from "@/app/components/guarded-form";
import { getActiveCriteria, resetCriteriaToDefaults, saveCriteria } from "@/lib/criteria";
import { invalidateUserInsights } from "@/lib/insights-cache";
import { requireActiveUserId } from "@/lib/session";

const BACK = "/settings/criteria";

function baseVersionOf(formData: FormData): number | undefined {
  const v = String(formData.get("baseVersion") ?? "");
  return /^\d{1,9}$/.test(v) ? Number(v) : undefined;
}

/**
 * Guarda el formulario de criterios (JS-096). Valida con Zod en el servidor (parseCriteriaForm);
 * si falla devuelve `{ ok: false, field }` (nunca el valor) y el formulario conserva lo editado. Lo
 * que el formulario no edita se copia de la versión vigente, y la versión que el usuario estaba
 * viendo viaja como `baseVersion` para no pisar un guardado más nuevo (`field: "conflict"`).
 */
export async function saveCriteriaAction(formData: FormData): Promise<FormActionError | void> {
  const userId = await requireActiveUserId();
  const baseVersion = baseVersionOf(formData);
  const active = await getActiveCriteria(userId);
  if (!active || baseVersion === undefined) return { ok: false, field: "conflict" };

  const raw: CriteriaFormRaw = {};
  for (const key of formData.keys()) {
    if (key in raw) continue;
    const values = formData.getAll(key).filter((v): v is string => typeof v === "string");
    raw[key] = key === "allowed_disciplines" ? values : values[0];
  }
  const parsed = parseCriteriaForm(raw, active.rules);
  if (!parsed.ok) return { ok: false, field: parsed.field };

  const saved = await saveCriteria(userId, parsed.rules, baseVersion);
  if (!saved.ok) return { ok: false, field: "conflict" };
  // «Si aprendés…» prefiltra el pool con estos criterios (E-2b)
  invalidateUserInsights(userId);
  revalidatePath(BACK);
  redirect(`${BACK}?saved=1`);
}

/**
 * Segundo paso del reinicio. La confirmación en dos pasos es UX; la integridad la dan la sesión
 * (el usuario sale de ella) y la versión base (sin ella o desactualizada, no se guarda).
 */
export async function resetCriteriaAction(formData: FormData): Promise<void> {
  const userId = await requireActiveUserId();
  const baseVersion = baseVersionOf(formData);
  if (baseVersion === undefined) redirect(`${BACK}?error=conflict`);
  const saved = await resetCriteriaToDefaults(userId, baseVersion);
  if (saved.ok) invalidateUserInsights(userId);
  revalidatePath(BACK);
  redirect(saved.ok ? `${BACK}?saved=reset` : `${BACK}?error=conflict`);
}
