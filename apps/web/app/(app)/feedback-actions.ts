"use server";

import { createLogger, safeDbError } from "@job-search-os/adapters";
import { validateFeedback, type FeedbackField } from "@job-search-os/pipeline";
import { saveFeedback } from "@/lib/beta-feedback";
import { requireActiveUserId } from "@/lib/session";

export type FeedbackResult = { ok: true } | { ok: false; field: FeedbackField | "_error" };

/**
 * «Contanos qué pasó» (C-23). El usuario sale de la sesión; valida categoría, mensaje y path
 * (pathname sin query ni fragmento) y aplica el tope diario en la base. Devuelve `{ ok, field }`,
 * nunca el texto. En los logs va solo `user_id` y la categoría: el mensaje no se loguea.
 */
export async function sendFeedbackAction(formData: FormData): Promise<FeedbackResult> {
  const userId = await requireActiveUserId();
  const checked = validateFeedback({
    category: formData.get("category"),
    message: formData.get("message"),
    path: formData.get("path"),
  });
  if (!checked.ok) return { ok: false, field: checked.field };
  const log = createLogger({ user_id: userId, task: "beta_feedback" });
  try {
    const saved = await saveFeedback(userId, checked.value);
    if (!saved.ok) {
      log.info({ category: checked.value.category }, "feedback: tope diario");
      return { ok: false, field: saved.field };
    }
    log.info({ category: checked.value.category }, "feedback: guardado");
    return { ok: true };
  } catch (error) {
    log.error({ category: checked.value.category, err: safeDbError(error) }, "feedback: falló");
    return { ok: false, field: "_error" };
  }
}
