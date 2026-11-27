"use server";

import { parseRequirementAnswerInput } from "@job-search-os/pipeline";
import { revalidatePath } from "next/cache";
import type { FormActionError } from "@/app/components/guarded-form";
import { isUuid } from "@/lib/ids";
import { requirementAnswersAllowedFor, saveRequirementAnswer } from "@/lib/requirement-answers";
import { requireActiveUserId } from "@/lib/session";

/**
 * La pregunta de un toque de «Qué pide el aviso» (R31-05): «Sí», «No» o «En parte» sobre un requisito que el
 * perfil no puede comparar. Guarda la respuesta de la persona (vale para las demás ofertas que pidan lo mismo)
 * y revalida la oferta: el estado de la fila lo decide el código al leer, sin volver a llamar al modelo.
 *
 * El usuario sale de la sesión. Todo lo que manda el cliente se valida: `jobId` es un uuid (solo decide qué ruta
 * se revalida) y la respuesta pasa por `parseRequirementAnswerInput`. Con `JOB_CARD` apagada para la persona no
 * hace nada. Devuelve `{ ok: false, field }` (nunca el valor) o `{ ok: true }`.
 */
export async function answerRequirementAction(input: {
  jobId: string;
  clave: string;
  valor: string;
  nota?: string | null;
}): Promise<FormActionError | { ok: true }> {
  const userId = await requireActiveUserId();
  if (!(await requirementAnswersAllowedFor(userId))) return { ok: false, field: "_error" };

  const jobId = (input as { jobId?: unknown } | null)?.jobId;
  if (typeof jobId !== "string" || !isUuid(jobId)) return { ok: false, field: "jobId" };

  const parsed = parseRequirementAnswerInput(input);
  if (!parsed.ok) return { ok: false, field: parsed.error };

  const saved = await saveRequirementAnswer(userId, parsed.value);
  if (!saved.ok) return { ok: false, field: "_error" };

  // La respuesta vale para otras ofertas: se revalida el detalle de esta y el listado
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/jobs");
  return { ok: true };
}
