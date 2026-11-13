import { notFound, redirect } from "next/navigation";
import { ReadClient } from "@/components/profile-agent/read-client";
import { isOnboardingComplete } from "@/lib/onboarding";
import { profileAgentAllowedFor } from "@/lib/profile-agent/read-server";
import { requireUserId } from "@/lib/session";

export const metadata = { title: "Subí tu CV y armamos tu perfil" };
export const dynamic = "force-dynamic";

/**
 * Subir el CV, como primer paso opcional del onboarding (ADR-034 §9, R10-1). Vive fuera de `(app)`
 * porque ese layout redirige acá mientras el perfil esté incompleto. Mismo componente que `/cv/perfil`.
 * Sin el flag, 404; con el onboarding ya completo, sigue en `/cv/perfil`. El layout del onboarding ya
 * exige sesión y términos.
 */
export default async function OnboardingCvPage() {
  const userId = await requireUserId();
  if (!(await profileAgentAllowedFor(userId))) notFound();
  if (await isOnboardingComplete(userId)) redirect("/cv/perfil");
  return (
    <section className="flex flex-col gap-5">
      <h1 className="text-title font-bold text-fg">Subí tu CV y armamos tu perfil</h1>
      <ReadClient base="onboarding" />
    </section>
  );
}
