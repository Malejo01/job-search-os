"use server";

import { schema as s } from "@job-search-os/db";
import {
  createLogger,
  loadProfilePrefilterPrefs,
  prefilterPrefsChanged,
  reprefilterJobs,
  safeDbError,
} from "@job-search-os/adapters";
import { parseProfileFieldUpdate } from "@job-search-os/pipeline";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import type { FormActionError } from "@/app/components/guarded-form";
import { withUser } from "@/lib/db";
import { isUuid } from "@/lib/ids";
import { invalidateUserInsights } from "@/lib/insights-cache";
import { requireActiveUserId } from "@/lib/session";

/**
 * «Actualizar mi inglés / mis años / mi país» desde «Esto mismo te pasa en N de tus M ofertas»
 * (R31-08). Guarda UN solo dato del perfil, sin tocar los demás: ni el resto del formulario de
 * «Tu perfil» ni las habilidades. La persona sale de la sesión; el pedido se valida con
 * `parseProfileFieldUpdate` (inglés CEFR, años de 0 a 60, país ISO-2) y devuelve `{ ok: false, field }`
 * (nunca el valor) o `{ ok: true }`. `jobId` solo decide qué ruta se revalida. Sin modelo: las
 * ofertas afectadas se recalculan al mostrarse (`withCurrentProfileFacts`).
 *
 * Si cambia el país o el inglés, los avisos que todavía no se evaluaron se vuelven a prefiltrar,
 * como en «Tu perfil»; si eso falla, el dato igual queda guardado.
 */
export async function saveProfileFieldFromJobAction(input: {
  field: string;
  value: string;
  jobId: string;
}): Promise<FormActionError | { ok: true }> {
  const userId = await requireActiveUserId();
  const jobId = (input as { jobId?: unknown } | null)?.jobId;
  if (typeof jobId !== "string" || !isUuid(jobId)) return { ok: false, field: "jobId" };
  const parsed = parseProfileFieldUpdate(input);
  if (!parsed.ok) return { ok: false, field: parsed.field };
  const { update } = parsed;

  const log = createLogger({ user_id: userId, task: "profile_field_from_job" });
  const before = await withUser(userId, (tx) => loadProfilePrefilterPrefs(tx, userId)).catch(
    () => null,
  );

  await withUser(userId, (tx) =>
    tx
      .update(s.profiles)
      .set(
        update.field === "ingles"
          ? { englishCefr: update.value }
          : update.field === "anos"
            ? { yearsTotal: update.value }
            : { locationCountry: update.value },
      )
      .where(eq(s.profiles.userId, userId)),
  );

  invalidateUserInsights(userId);
  if (before && update.field !== "anos") {
    try {
      await withUser(userId, async (tx) => {
        const after = await loadProfilePrefilterPrefs(tx, userId);
        if (!prefilterPrefsChanged(before, after)) return;
        await reprefilterJobs(tx, userId, { logger: log });
      });
    } catch (e) {
      log.error({ err: safeDbError(e) }, "reprefilter: falló; el dato quedó guardado");
    }
  }
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/jobs");
  revalidatePath("/settings/perfil");
  return { ok: true };
}
