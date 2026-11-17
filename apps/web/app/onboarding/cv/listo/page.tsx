import { profileAgentNextSteps, profileAgentPath } from "@job-search-os/pipeline";
import { notFound, redirect } from "next/navigation";
import { ProfileAgentClose } from "@/components/profile-agent/close";
import { isOnboardingComplete } from "@/lib/onboarding";
import { profileAgentAllowedFor } from "@/lib/profile-agent/access";
import { requireTermsAcceptedUserId } from "@/lib/session";
import { OnboardingSteps } from "../../steps";

export const metadata = { title: "Tu CV está listo" };
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Cierre del agente de perfil durante el onboarding (ADR-034 §9): las mismas pantallas que `/cv/perfil/listo`,
 * porque con el perfil incompleto el layout de `(app)` redirige y esa ruta no se alcanza. Con el flag
 * apagado, 404. Con el perfil ya completo, vuelve a la ruta de la app.
 */
export default async function OnboardingProfileAgentDonePage() {
  const userId = await requireTermsAcceptedUserId();
  if (!(await profileAgentAllowedFor(userId))) notFound();
  if (await isOnboardingComplete(userId)) redirect(profileAgentPath("app", "done"));
  return (
    <section className="flex flex-col gap-5">
      <OnboardingSteps current={1} />
      <h1 className="no-print text-title font-bold">Tu CV y qué sigue</h1>
      <ProfileAgentClose base="onboarding" nextSteps={profileAgentNextSteps("onboarding")} />
    </section>
  );
}
