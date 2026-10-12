import { DEFAULT_CRITERIA_RULES, defaultRole } from "@job-search-os/pipeline";
import { redirect } from "next/navigation";
import { isOnboardingComplete } from "@/lib/onboarding";
import { requireUserId } from "@/lib/session";
import { ROLE_SKILLS, getSkillsPageData } from "@/lib/skill-levels";
import { SkillsForm, parseRoleParam } from "../../(app)/settings/skills/skills-form";
import { saveOnboardingSkillsAction } from "./actions";

export const dynamic = "force-dynamic";

/** Paso opcional del onboarding: niveles de skills. Sin perfil completo vuelve al paso 1. */
export default async function OnboardingSkillsPage({
  searchParams,
}: {
  searchParams: Promise<{ rol?: string; error?: string }>;
}) {
  const userId = await requireUserId();
  if (!(await isOnboardingComplete(userId))) redirect("/onboarding");
  const [data, { rol, error }] = await Promise.all([getSkillsPageData(userId), searchParams]);
  const role =
    parseRoleParam(rol) ??
    defaultRole({
      headline: data.headline,
      allowedDisciplines: data.allowedDisciplines,
      defaultDisciplines: DEFAULT_CRITERIA_RULES.allowed_disciplines,
    });

  return (
    <section className="flex flex-col gap-3">
      <h1 className="text-xl font-semibold">Tus skills</h1>
      <p className="text-sm text-zinc-600">
        Opcional. Con tus niveles, el mercado y el plan muestran lo que te falta de verdad. Lo podés
        cambiar después en Ajustes
      </p>
      {error ? (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          Revisá los datos del formulario y volvé a intentar.
        </p>
      ) : null}
      <SkillsForm
        action={saveOnboardingSkillsAction}
        basePath="/onboarding/skills"
        roleMap={ROLE_SKILLS}
        role={role}
        taxonomy={data.taxonomy}
        levels={data.levels}
        submitLabel="Guardar y seguir"
        allowRemove={false}
        skip={{ href: "/onboarding/asistente", label: "Saltear por ahora" }}
      />
    </section>
  );
}
