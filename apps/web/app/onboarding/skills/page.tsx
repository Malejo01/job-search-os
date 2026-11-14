import {
  DEFAULT_CRITERIA_RULES,
  defaultRole,
  profileAgentSkipSkillsStep,
} from "@job-search-os/pipeline";
import { redirect } from "next/navigation";
import { GuidedTour } from "@/components/guided-tour";
import { buttonClasses } from "@/components/ui";
import { profileAgentAllowedFor } from "@/lib/profile-agent/access";
import { loadAgentOnboardingFacts } from "@/lib/profile-agent/close-server";
import { dismissGuideAction } from "@/lib/guide-actions";
import { GUIDE_LABELS, GUIDE_STEPS } from "@/lib/guide";
import { getTargetRoles, isOnboardingComplete } from "@/lib/onboarding";
import { requireUserId } from "@/lib/session";
import { ROLE_SKILLS, getSkillsPageData } from "@/lib/skill-levels";
import { SkillsForm, parseRoleParam } from "../../(app)/settings/skills/skills-form";
import { OnboardingSteps } from "../steps";
import { saveOnboardingSkillsAction } from "./actions";

export const metadata = { title: "Tus skills" };
export const dynamic = "force-dynamic";
// La acción programa la primera evaluación en after(): corre dentro de este límite
export const maxDuration = 120;

/** Con las skills ya cargadas desde el CV: un solo botón, que sigue por el mismo camino que «Saltear por ahora». */
function SkillsFromCv() {
  async function keepGoing(): Promise<void> {
    "use server";
    const form = new FormData();
    form.set("saltear", "1");
    await saveOnboardingSkillsAction(form);
  }
  return (
    <section className="flex flex-col gap-5" data-testid="onboarding-skills-from-cv">
      <OnboardingSteps current={2} skillsFromCv />
      <div className="flex flex-col gap-1">
        <h1 className="text-title font-bold">Tus skills</h1>
        <p className="text-sm text-fg-subtle">
          Ya cargamos tus skills con lo que confirmaste de tu CV. Las podés cambiar cuando quieras
          en Ajustes.
        </p>
      </div>
      <form action={keepGoing}>
        <button type="submit" className={buttonClasses()} data-testid="onboarding-skills-continue">
          Seguir a tus primeras ofertas
        </button>
      </form>
    </section>
  );
}

/** Paso opcional del onboarding: niveles de skills. Sin perfil completo vuelve al paso 1. */
export default async function OnboardingSkillsPage({
  searchParams,
}: {
  searchParams: Promise<{ rol?: string }>;
}) {
  const userId = await requireUserId();
  if (!(await isOnboardingComplete(userId))) redirect("/onboarding");
  // Agente de perfil (ADR-034, R10-5): quien ya cargó sus skills con el CV no las vuelve a cargar. Con el flag
  // apagado no hay consulta y el paso queda como siempre. Un solo clic sigue: la salida de este paso arma
  // la primera evaluación (`saveOnboardingSkillsAction` con «saltear»), y no se muta nada al abrir la página.
  if (
    (await profileAgentAllowedFor(userId)) &&
    profileAgentSkipSkillsStep(true, await loadAgentOnboardingFacts(userId))
  ) {
    return <SkillsFromCv />;
  }
  const [data, targetRoles, { rol }] = await Promise.all([
    getSkillsPageData(userId),
    getTargetRoles(userId),
    searchParams,
  ]);
  const chosen = parseRoleParam(rol);
  // Primero lo que miró en esta pantalla, después el puesto principal del paso 1, después el deducido
  const role =
    chosen ??
    targetRoles[0] ??
    defaultRole({
      headline: data.headline,
      allowedDisciplines: data.allowedDisciplines,
      defaultDisciplines: DEFAULT_CRITERIA_RULES.allowed_disciplines,
    });

  return (
    <section className="flex flex-col gap-5">
      <OnboardingSteps
        current={2}
        guide={
          <GuidedTour
            steps={GUIDE_STEPS.skills}
            label={GUIDE_LABELS.panel}
            testId="guide"
            openerLabel={GUIDE_LABELS.opener}
            resume
            onDone={dismissGuideAction}
          />
        }
      />
      <div className="flex flex-col gap-1">
        <h1 className="text-title font-bold">Tus skills</h1>
        <p className="text-sm text-fg-subtle">
          Opcional. Con tus niveles te mostramos qué te falta de verdad en el mercado y en tu plan.
          Lo podés cambiar después en Ajustes.
        </p>
      </div>
      <SkillsForm
        action={saveOnboardingSkillsAction}
        selectedRoles={targetRoles}
        basePath="/onboarding/skills"
        roleMap={ROLE_SKILLS}
        role={role}
        taxonomy={data.taxonomy}
        levels={data.levels}
        englishCefr={data.englishCefr}
        customSkills={data.customSkills}
        submitLabel="Guardar y seguir"
        allowRemove={false}
        skip={{ label: "Saltear por ahora" }}
      />
    </section>
  );
}
