import {
  areasFilterEnabled,
  CEFR_LEVELS,
  COUNTRY_OPTIONS,
  ISO_COUNTRY_CODES,
  MAX_SUMMARY_CHARS,
  MIN_SUMMARY_CHARS,
  profileAgentOnboardingChoiceVisible,
  profileAgentSkipSkillsStep,
  profileAgentUsed,
  profileRoleGroups,
  TARGET_ROLES_DEFAULT_LIMIT,
} from "@job-search-os/pipeline";
import { redirect } from "next/navigation";
import { GuidedTour } from "@/components/guided-tour";
import { getCareerSalaries, getCareerSpanishCounts } from "@/lib/career-market";
import { dismissGuideAction } from "@/lib/guide-actions";
import { GUIDE_INVITE, GUIDE_LABELS, GUIDE_STEPS, guideDismissed } from "@/lib/guide";
import { OnboardingChoice } from "@/components/profile-agent/onboarding-choice";
import { profileAgentAllowedFor } from "@/lib/profile-agent/access";
import { loadAgentOnboardingFacts } from "@/lib/profile-agent/close-server";
import {
  getProfileForEdit,
  getTargetRoles,
  getTargetRolesLimit,
  getTargetSpecialties,
  isOnboardingComplete,
} from "@/lib/onboarding";
import { requireUserId } from "@/lib/session";
import { catalogLabel } from "@/lib/career-names";
import { DeleteAccountForm } from "../(app)/settings/delete-account-form";
import { OnboardingForm } from "./onboarding-form";
import { OnboardingSteps } from "./steps";
import { Illustration } from "@/components/brand/illustration";

export const dynamic = "force-dynamic";
// La primera ingesta corre en `after()` al guardar y hereda la duración de esta ruta
export const maxDuration = 120;

/**
 * Onboarding obligatorio (B2, JS-094): sin país, resumen y criterios el evaluador no tiene con
 * qué trabajar. El gate está en el layout de (app); si el perfil ya está completo, va a /hoy (119b).
 * El formulario es de cliente (`OnboardingForm`): ante un error no recarga y no pierde lo cargado.
 */
export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const userId = await requireUserId();
  if (await isOnboardingComplete(userId)) redirect("/hoy");
  const [
    { error },
    targetRoles,
    targetSpecialties,
    rolesLimit,
    salaries,
    inviteDismissed,
    spanishCounts,
  ] = await Promise.all([
    searchParams,
    getTargetRoles(userId),
    getTargetSpecialties(userId),
    getTargetRolesLimit(userId),
    // Informativo: si el pool no responde, el selector se ve igual, sin sueldos
    getCareerSalaries().catch(() => undefined),
    guideDismissed(userId),
    // Informativo, igual que los sueldos
    getCareerSpanishCounts().catch(() => undefined),
  ]);
  // Agente de perfil desde el CV (ADR-034, R10-5): con el flag apagado no hay consulta y la pantalla queda
  // exactamente como siempre. Lo completado por el agente se deriva de la base, sin banderas en la URL.
  const agentOn = await profileAgentAllowedFor(userId);
  const agentFacts = agentOn ? await loadAgentOnboardingFacts(userId) : null;
  const showChoice = agentFacts !== null && profileAgentOnboardingChoiceVisible(true, agentFacts);
  const saved =
    agentFacts !== null && profileAgentUsed(agentFacts) ? await getProfileForEdit(userId) : null;
  const agentInitial = saved
    ? {
        ...saved,
        acceptedModalities:
          saved.acceptedModalities.length > 0 ? saved.acceptedModalities : ["remoto"],
      }
    : undefined;
  const roleGroups = profileRoleGroups(targetRoles).map((group) => ({
    label: group.label,
    roles: group.roles.map((key) => ({ key, label: catalogLabel(key) })),
  }));
  return (
    <section className="flex flex-col gap-5">
      <OnboardingSteps
        current={1}
        skillsFromCv={agentFacts !== null && profileAgentSkipSkillsStep(true, agentFacts)}
        guide={
          <GuidedTour
            steps={GUIDE_STEPS.perfil}
            label={GUIDE_LABELS.panel}
            testId="guide"
            openerLabel={GUIDE_LABELS.opener}
            resume
            onDone={dismissGuideAction}
            invite={inviteDismissed ? undefined : GUIDE_INVITE}
          />
        }
      />
      {/* Ilustración «bienvenida» (C9-13): una por pantalla, arriba del primer paso */}
      <Illustration escena="bienvenida" priority className="w-40 sm:w-52" />
      <div className="flex flex-col gap-1">
        <h1 className="text-title font-bold">Completá tu perfil</h1>
        <p className="text-sm text-fg-subtle">
          Antes de ver ofertas, contanos un poco de vos: con esto leemos cada aviso contra tu
          perfil. Lo podés cambiar cuando quieras.
        </p>
      </div>
      {showChoice ? <OnboardingChoice /> : null}
      <OnboardingForm
        agentInitial={agentInitial}
        roleGroups={roleGroups}
        salaries={salaries}
        spanishCounts={spanishCounts}
        selectedRoles={targetRoles}
        specialtySelection={targetSpecialties}
        areasFilter={areasFilterEnabled(process.env)}
        rolesLimit={rolesLimit}
        defaultRolesLimit={TARGET_ROLES_DEFAULT_LIMIT}
        countries={COUNTRY_OPTIONS}
        cefrLevels={CEFR_LEVELS}
        countryCodes={ISO_COUNTRY_CODES}
        minSummary={MIN_SUMMARY_CHARS}
        maxSummary={MAX_SUMMARY_CHARS}
      />
      <div className="mt-2 border-t border-line pt-5">
        <DeleteAccountForm error={error === "confirmacion"} returnTo="/onboarding" />
      </div>
    </section>
  );
}
