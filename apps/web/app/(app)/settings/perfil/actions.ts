"use server";

import {
  createLogger,
  loadProfilePrefilterPrefs,
  prefilterPrefsChanged,
  reprefilterJobs,
  safeDbError,
} from "@job-search-os/adapters";
import { revalidatePath } from "next/cache";
import type { ProfileActionResult } from "@/components/profile-form";
import { withUser } from "@/lib/db";
import { invalidateUserInsights } from "@/lib/insights-cache";
import { saveProfileFromForm } from "@/lib/onboarding";
import { requireActiveUserId } from "@/lib/session";

/**
 * Guarda «Tu perfil» (CV-00): modalidad, país, idioma de las ofertas, inglés, años, autorización y
 * resumen. Es el mismo núcleo que el onboarding (`saveProfileFromForm`), con dos diferencias: los
 * puestos, el piso salarial y las horas se mantienen como están guardados (los puestos se editan en
 * «Tus puestos»; el piso y las horas, en los criterios), y no redirige ni dispara la ingesta: vuelve
 * `{ ok: true }` y el formulario muestra «Guardado». El usuario sale de la sesión, no del formulario.
 *
 * Si cambió la modalidad, el país, la ciudad o el idioma de las ofertas, los avisos que todavía no
 * se evaluaron se vuelven a prefiltrar con el perfil nuevo (ronda 91, sin LLM). Si eso falla, el
 * perfil igual queda guardado: se loguea y la acción no se rompe.
 */
export async function savePerfilAction(formData: FormData): Promise<ProfileActionResult> {
  const userId = await requireActiveUserId();
  // Si no se puede leer el perfil anterior, no hay con qué comparar: se guarda sin re-prefiltrar
  const before = await withUser(userId, (tx) => loadProfilePrefilterPrefs(tx, userId)).catch(
    (e) => {
      createLogger({ user_id: userId, task: "reprefilter" }).warn(
        { err: safeDbError(e) },
        "reprefilter: no se pudo leer el perfil anterior; se guarda sin re-prefiltrar",
      );
      return null;
    },
  );
  const result = await saveProfileFromForm(userId, formData, { keepStored: true });
  if (!result.ok) return result;
  // País, modalidad, idioma e inglés cambian el prefiltro de «Si aprendés…» y el texto de «Tu encaje» (E-2b)
  invalidateUserInsights(userId);
  if (before) {
    const log = createLogger({ user_id: userId, task: "reprefilter" });
    try {
      await withUser(userId, async (tx) => {
        const after = await loadProfilePrefilterPrefs(tx, userId);
        if (!prefilterPrefsChanged(before, after)) return;
        await reprefilterJobs(tx, userId, { logger: log });
      });
    } catch (e) {
      log.error({ err: safeDbError(e) }, "reprefilter: falló; el perfil quedó guardado");
    }
  }
  revalidatePath("/settings/perfil");
  revalidatePath("/jobs");
  return { ok: true };
}
