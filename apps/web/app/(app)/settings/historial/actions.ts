"use server";

import { createLogger, safeDbError } from "@job-search-os/adapters";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { addCareerHistory, deleteCareerHistory, updateCareerHistory } from "@/lib/career-history";
import { validateHistory, type HistoryField } from "@/lib/career-history-core";
import { requireActiveUserId } from "@/lib/session";

const PATH = "/settings/historial";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Vuelve a la pantalla con el campo que falló (nunca el valor) o con `ok`. */
function back(result: { error: HistoryField | "generic" } | { ok: "saved" | "deleted" }): never {
  const q = "error" in result ? `error=${result.error}` : `ok=${result.ok}`;
  redirect(`${PATH}?${q}`);
}

function entryId(formData: FormData): string | null {
  const id = formData.get("id");
  return typeof id === "string" && UUID_RE.test(id) ? id : null;
}

/**
 * Historial del CV (C-25, CVC-2). El usuario sale de la sesión, nunca del formulario; la RLS deja
 * tocar solo sus filas. Valida con `validateHistory` (topes de 20 entradas y 220 caracteres por
 * viñeta). Los logs llevan `user_id` y el tipo de error, nunca el texto cargado.
 */
export async function addHistoryAction(formData: FormData): Promise<void> {
  const userId = await requireActiveUserId();
  const checked = validateHistory(formData);
  if (!checked.ok) back({ error: checked.field });
  const log = createLogger({ user_id: userId, task: "career_history" });
  let result;
  try {
    result = await addCareerHistory(userId, checked.value);
  } catch (error) {
    log.error({ err: safeDbError(error) }, "career_history: alta falló");
    return back({ error: "generic" });
  }
  if (!result.ok) return back({ error: result.field });
  revalidatePath("/cv");
  return back({ ok: "saved" });
}

export async function updateHistoryAction(formData: FormData): Promise<void> {
  const userId = await requireActiveUserId();
  const id = entryId(formData);
  if (!id) return back({ error: "generic" });
  const checked = validateHistory(formData);
  if (!checked.ok) return back({ error: checked.field });
  const log = createLogger({ user_id: userId, task: "career_history" });
  let found: boolean;
  try {
    found = await updateCareerHistory(userId, id, checked.value);
  } catch (error) {
    log.error({ err: safeDbError(error) }, "career_history: edición falló");
    return back({ error: "generic" });
  }
  if (!found) return back({ error: "generic" });
  revalidatePath("/cv");
  return back({ ok: "saved" });
}

export async function deleteHistoryAction(formData: FormData): Promise<void> {
  const userId = await requireActiveUserId();
  const id = entryId(formData);
  if (!id) return back({ error: "generic" });
  const log = createLogger({ user_id: userId, task: "career_history" });
  try {
    await deleteCareerHistory(userId, id);
  } catch (error) {
    log.error({ err: safeDbError(error) }, "career_history: baja falló");
    return back({ error: "generic" });
  }
  revalidatePath("/cv");
  return back({ ok: "deleted" });
}
