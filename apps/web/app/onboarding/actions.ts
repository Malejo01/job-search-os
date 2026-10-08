"use server";

import { createLogger } from "@job-search-os/adapters";
import { parseOnboarding } from "@job-search-os/pipeline";
import { redirect } from "next/navigation";
import { upgradeLegacyInboundAddress } from "@/lib/inbound-address";
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
  // JS-095: la dirección derivada del id se cambia por una aleatoria (si ya lo es, no se toca)
  // Es accesorio: si falla, el onboarding sigue (la dirección se puede rotar desde Ajustes)
  try {
    await upgradeLegacyInboundAddress(userId);
  } catch {
    createLogger({ user_id: userId, task: "inbound_address" }).error(
      "no se pudo asignar la dirección de email entrante",
    );
  }
  redirect("/jobs");
}
