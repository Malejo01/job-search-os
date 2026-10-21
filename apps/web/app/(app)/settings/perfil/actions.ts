"use server";

import { revalidatePath } from "next/cache";
import type { ProfileActionResult } from "@/components/profile-form";
import { saveProfileFromForm } from "@/lib/onboarding";
import { requireUserId } from "@/lib/session";

/**
 * Guarda «Tu perfil» (CV-00): modalidad, país, idioma de las ofertas, inglés, años, autorización y
 * resumen. Es el mismo núcleo que el onboarding (`saveProfileFromForm`), con dos diferencias: los
 * puestos, el piso salarial y las horas se mantienen como están guardados (los puestos se editan en
 * «Tus puestos»; el piso y las horas, en los criterios), y no redirige ni dispara la ingesta: vuelve
 * `{ ok: true }` y el formulario muestra «Guardado». El usuario sale de la sesión, no del formulario.
 */
export async function savePerfilAction(formData: FormData): Promise<ProfileActionResult> {
  const userId = await requireUserId();
  const result = await saveProfileFromForm(userId, formData, { keepStored: true });
  if (!result.ok) return result;
  revalidatePath("/settings/perfil");
  revalidatePath("/jobs");
  return { ok: true };
}
