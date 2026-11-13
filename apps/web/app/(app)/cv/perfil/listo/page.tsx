import { profileAgentNextSteps } from "@job-search-os/pipeline";
import { notFound } from "next/navigation";
import { ProfileAgentClose } from "@/components/profile-agent/close";
import { profileAgentAllowedFor } from "@/lib/profile-agent/access";
import { requireActiveUserId } from "@/lib/session";

export const metadata = { title: "Tu CV está listo" };
export const dynamic = "force-dynamic";
// El cierre llama al modelo (redacción del CV): el límite de la ruta de la API es el que manda
export const maxDuration = 60;

/**
 * Cierre del agente de perfil con el onboarding completo (ADR-034 §9, pantalla 5): arma el CV ATS con lo
 * confirmado, lo muestra y lleva a Word, PDF y «qué sigue». Con el flag apagado, 404 como cualquier ruta
 * que no existe. Server Component: el trabajo está en el componente de cliente y en `/api/cv-perfil/cierre`.
 */
export default async function ProfileAgentDonePage() {
  const userId = await requireActiveUserId();
  if (!(await profileAgentAllowedFor(userId))) notFound();
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <h1 className="no-print text-title font-bold">Tu CV y qué sigue</h1>
      <ProfileAgentClose base="app" nextSteps={profileAgentNextSteps("app")} />
    </div>
  );
}
