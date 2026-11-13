import { notFound } from "next/navigation";
import { ProfileGuide } from "@/components/profile-agent/guide";
import { profileAgentAllowedFor } from "@/lib/profile-agent/gaps-server";
import { requireActiveUserId } from "@/lib/session";

export const metadata = { title: "Guía de búsqueda" };
export const dynamic = "force-dynamic";

/**
 * Guía de búsqueda del agente de perfil (ADR-034, R10-4), con el onboarding ya completo. Con el flag apagado,
 * 404 como cualquier ruta que no existe. Sin modelo: opciones, datos y copy fijo.
 */
export default async function PerfilGuiaPage() {
  const userId = await requireActiveUserId();
  if (!(await profileAgentAllowedFor(userId))) notFound();
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <h1 className="text-title font-bold">Guía de búsqueda</h1>
      <ProfileGuide base="app" />
    </div>
  );
}
