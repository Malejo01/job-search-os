import {
  CEFR_LEVELS,
  COUNTRY_OPTIONS,
  ISO_COUNTRY_CODES,
  MAX_SUMMARY_CHARS,
  MIN_SUMMARY_CHARS,
  selectableRoleGroups,
  TARGET_ROLES_DEFAULT_LIMIT,
} from "@job-search-os/pipeline";
import { redirect } from "next/navigation";
import { GuidedTour } from "@/components/guided-tour";
import { getCareerSalaries, getCareerSpanishCounts } from "@/lib/career-market";
import { dismissGuideAction } from "@/lib/guide-actions";
import { GUIDE_INVITE, GUIDE_LABELS, GUIDE_STEPS, guideDismissed } from "@/lib/guide";
import { getTargetRoles, getTargetRolesLimit, isOnboardingComplete } from "@/lib/onboarding";
import { requireUserId } from "@/lib/session";
import { ROLE_SKILLS } from "@/lib/skill-levels";
import { DeleteAccountForm } from "../(app)/settings/delete-account-form";
import { OnboardingForm } from "./onboarding-form";
import { OnboardingSteps } from "./steps";

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
  const [{ error }, targetRoles, rolesLimit, salaries, inviteDismissed, spanishCounts] =
    await Promise.all([
      searchParams,
      getTargetRoles(userId),
      getTargetRolesLimit(userId),
      // Informativo: si el pool no responde, el selector se ve igual, sin sueldos
      getCareerSalaries().catch(() => undefined),
      guideDismissed(userId),
      // Informativo, igual que los sueldos
      getCareerSpanishCounts().catch(() => undefined),
    ]);
  const roleGroups = selectableRoleGroups(targetRoles).map((group) => ({
    label: group.label,
    roles: group.roles.map((key) => ({ key, label: ROLE_SKILLS[key].label })),
  }));
  return (
    <section className="flex flex-col gap-3">
      <OnboardingSteps
        current={1}
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
      <h1 className="text-xl font-semibold">Completá tu perfil</h1>
      <p className="text-sm text-fg-subtle">
        Antes de ver ofertas necesitamos unos datos: con ellos se filtran y evalúan los avisos. Los
        podés cambiar más adelante.
      </p>
      <OnboardingForm
        roleGroups={roleGroups}
        salaries={salaries}
        spanishCounts={spanishCounts}
        selectedRoles={targetRoles}
        rolesLimit={rolesLimit}
        defaultRolesLimit={TARGET_ROLES_DEFAULT_LIMIT}
        countries={COUNTRY_OPTIONS}
        cefrLevels={CEFR_LEVELS}
        countryCodes={ISO_COUNTRY_CODES}
        minSummary={MIN_SUMMARY_CHARS}
        maxSummary={MAX_SUMMARY_CHARS}
      />
      <div className="mt-4 border-t border-line pt-4">
        <DeleteAccountForm error={error === "confirmacion"} returnTo="/onboarding" />
      </div>
    </section>
  );
}
