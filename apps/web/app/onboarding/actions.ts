"use server";

import { parseOnboarding } from "@job-search-os/pipeline";
import { redirect } from "next/navigation";
import { completeOnboarding } from "@/lib/onboarding";
import { requireUserId } from "@/lib/session";

/**
 * Guarda el onboarding (B2). Valida con Zod (parseOnboarding); si falla vuelve al formulario con
 * el nombre del campo, nunca con el valor. El usuario sale de la sesión, no del formulario.
 */
export async function saveOnboardingAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const raw: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (typeof v === "string") raw[k] = v;
  const parsed = parseOnboarding(raw);
  if (!parsed.ok) redirect(`/onboarding?error=${encodeURIComponent(parsed.field)}`);
  const saved = await completeOnboarding(userId, parsed.value);
  if (!saved) redirect("/onboarding?error=perfil");
  redirect("/jobs");
}
