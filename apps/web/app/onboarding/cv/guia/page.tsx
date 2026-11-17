import { notFound } from "next/navigation";
import { ProfileGuide } from "@/components/profile-agent/guide";
import { profileAgentAllowedFor } from "@/lib/profile-agent/access";
import { requireUserId } from "@/lib/session";

export const metadata = { title: "Guía de búsqueda" };
export const dynamic = "force-dynamic";

/**
 * Guía de búsqueda dentro del onboarding (ADR-034 §9): mismo componente que la de `(app)`. Antes de completar
 * el onboarding no escribe criterios ni país: quedan en el estado del navegador y precargan el formulario.
 */
export default async function OnboardingGuiaPage() {
  const userId = await requireUserId();
  if (!(await profileAgentAllowedFor(userId))) notFound();
  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-title font-bold">Guía de búsqueda</h1>
      <ProfileGuide base="onboarding" />
    </div>
  );
}
