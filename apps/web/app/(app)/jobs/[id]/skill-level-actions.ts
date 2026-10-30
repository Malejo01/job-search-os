"use server";

import { parseSingleSkillLevel } from "@job-search-os/pipeline";
import { revalidatePath } from "next/cache";
import type { FormActionError } from "@/app/components/guarded-form";
import { isUuid } from "@/lib/ids";
import { invalidateUserInsights } from "@/lib/insights-cache";
import { scheduleMarketRecompute } from "@/lib/market-recompute";
import { reassignForSkills, scheduleImmediateEvaluation } from "@/lib/pool-reassign";
import { requireActiveUserId } from "@/lib/session";
import { getSkillsSaveContext, saveSkillLevels } from "@/lib/skill-levels";

/**
 * Carga el nivel de UNA skill desde el detalle de una oferta (C-20), sin salir de ella. Mismos
 * efectos que `saveSkillsAction` de Ajustes, pero sin `redirect` y guardando solo esa fila: no puede
 * borrar ni pisar otras skills. El usuario sale de la sesión; `slug` se valida contra la taxonomía,
 * `level` es un entero de 0 a 3 y los slugs de inglés se rechazan (van por CEFR en Ajustes). `jobId`
 * solo decide qué ruta se revalida: se valida su forma y nada más. Devuelve `{ ok: false, field }`
 * (nunca el valor) o `{ ok: true }`. Sin LLM.
 */
export async function saveSkillLevelFromJobAction(input: {
  slug: string;
  level: number;
  jobId: string;
}): Promise<FormActionError | { ok: true }> {
  const userId = await requireActiveUserId();
  const jobId = (input as { jobId?: unknown } | null)?.jobId;
  if (typeof jobId !== "string" || !isUuid(jobId)) return { ok: false, field: "jobId" };

  const { taxonomy } = await getSkillsSaveContext(userId);
  const parsed = parseSingleSkillLevel(
    input,
    taxonomy.map((t) => t.slug),
  );
  if (!parsed.ok) return { ok: false, field: parsed.field };

  const { changed } = await saveSkillLevels(userId, [parsed.entry]);
  // Los niveles cambian «Tu encaje» y «Si aprendés…» (E-2b): invalida fit: y plan-impact:
  invalidateUserInsights(userId);
  if (changed > 0) {
    scheduleMarketRecompute(userId, { inputsChanged: true });
    // Reasignación del pool (ronda 41): solo actúa si la persona nunca evaluó nada del pool
    const result = await reassignForSkills(userId);
    if (result.firstTime) scheduleImmediateEvaluation(userId, result.enqueuedJobIds);
  }
  revalidatePath(`/jobs/${jobId}`);
  return { ok: true };
}
