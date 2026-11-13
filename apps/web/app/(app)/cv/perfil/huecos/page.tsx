import { notFound } from "next/navigation";
import { ProfileGaps } from "@/components/profile-agent/gaps";
import { profileAgentAllowedFor } from "@/lib/profile-agent/gaps-server";
import { requireActiveUserId } from "@/lib/session";

export const metadata = { title: "Completemos lo que falta" };
export const dynamic = "force-dynamic";

/**
 * Etapa de huecos del agente de perfil (ADR-034, R10-3), con el onboarding ya completo. Server Component:
 * con el flag apagado responde 404 como cualquier ruta que no existe. La charla vive en el componente de
 * cliente y no se guarda; solo queda lo que la persona confirma.
 */
export default async function PerfilHuecosPage() {
  const userId = await requireActiveUserId();
  if (!(await profileAgentAllowedFor(userId))) notFound();
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <h1 className="text-title font-bold">Completemos lo que falta</h1>
      <p className="text-sm text-fg-muted">
        Te pregunto de a una cosa, solo sobre lo que quedó flojo o sin completar. Podés responder
        «No tengo» o saltear. Nada cambia en tu perfil hasta que confirmes cada tarjeta.
      </p>
      <ProfileGaps base="app" />
    </div>
  );
}
