import { notFound } from "next/navigation";
import { AtsSkillsProvider } from "@/components/profile-agent/ats-check";
import { ReadClient } from "@/components/profile-agent/read-client";
import { profileAgentAllowedFor } from "@/lib/profile-agent/access";
import { loadAtsCareerSkills } from "@/lib/profile-agent/ats-skills";
import { requireActiveUserId } from "@/lib/session";

export const metadata = { title: "Subí tu CV y armamos tu perfil" };
export const dynamic = "force-dynamic";

/**
 * Subir el CV y leerlo (ADR-034 §9, R10-1). Server Component: chequea sesión y el flag
 * `CV_PROFILE_AGENT` (apagado = 404, como si la página no existiera) y deja la lectura en un componente de
 * cliente. El archivo no se sube ni se guarda: se lee en el navegador.
 */
export default async function PerfilCvPage() {
  const userId = await requireActiveUserId();
  if (!(await profileAgentAllowedFor(userId))) notFound();
  const atsSkills = await loadAtsCareerSkills(userId);
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <h1 className="text-title font-bold text-fg">Subí tu CV y armamos tu perfil</h1>
      <AtsSkillsProvider skills={atsSkills}>
        <ReadClient base="app" />
      </AtsSkillsProvider>
    </div>
  );
}
