import { notFound } from "next/navigation";
import { ProfileGaps } from "@/components/profile-agent/gaps";
import { profileAgentAllowedFor } from "@/lib/profile-agent/gaps-server";
import { requireUserId } from "@/lib/session";

export const metadata = { title: "Completemos lo que falta" };
export const dynamic = "force-dynamic";

/**
 * Etapa de huecos del agente de perfil dentro del onboarding (ADR-034 §9): mismo componente que la página de
 * `(app)`, que durante el onboarding no se alcanza. Con el flag apagado, 404.
 */
export default async function OnboardingHuecosPage() {
  const userId = await requireUserId();
  if (!(await profileAgentAllowedFor(userId))) notFound();
  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-title font-bold">Completemos lo que falta</h1>
      <p className="text-sm text-fg-muted">
        Te pregunto de a una cosa, solo sobre lo que quedó flojo o sin completar. Podés responder
        «No tengo» o saltear. Nada cambia en tu perfil hasta que confirmes cada tarjeta.
      </p>
      <ProfileGaps base="onboarding" />
    </div>
  );
}
