"use server";

import { redirect } from "next/navigation";
import { isOnboardingComplete } from "@/lib/onboarding";
import { requireUserId } from "@/lib/session";
import { validateTermsAcceptance } from "@/lib/terms";
import { acceptCurrentTerms } from "@/lib/terms-status";

export type AcceptTermsResult = { error: string };

/**
 * Re-aceptación de los términos (ronda 83). La casilla se valida acá, no en el navegador; la versión
 * que se guarda es la vigente del servidor, nunca un valor del formulario. Sin la casilla devuelve el
 * error para mostrarlo junto al campo; con ella redirige (a /onboarding si falta el perfil).
 */
export async function acceptTermsAction(formData: FormData): Promise<AcceptTermsResult | void> {
  const userId = await requireUserId();
  const accepted = validateTermsAcceptance(formData.get("terminos"));
  if (!accepted.ok) return { error: "Para seguir tenés que aceptar los términos." };
  await acceptCurrentTerms(userId);
  redirect((await isOnboardingComplete(userId)) ? "/jobs" : "/onboarding");
}
