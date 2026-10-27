import { DEFAULT_CRITERIA_RULES, defaultRole } from "@job-search-os/pipeline";
import Link from "next/link";
import { getTargetRoles } from "@/lib/onboarding";
import { requireUserId } from "@/lib/session";
import { ROLE_SKILLS, getSkillsPageData } from "@/lib/skill-levels";
import { saveSkillsAction } from "./actions";
import { SkillsForm, parseRoleParam } from "./skills-form";

export const metadata = { title: "Mis skills" };
export const dynamic = "force-dynamic";
// La acción puede programar la primera evaluación en after(): corre dentro de este límite
export const maxDuration = 120;

/** Mis skills (ronda 28): niveles autodeclarados que usan el mercado, el plan y el prescore. */
export default async function SkillsSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ rol?: string; guardado?: string }>;
}) {
  const userId = await requireUserId();
  const [data, targetRoles, { rol, guardado }] = await Promise.all([
    getSkillsPageData(userId),
    getTargetRoles(userId),
    searchParams,
  ]);
  const chosen = parseRoleParam(rol);
  // Primero lo que miró en esta pantalla, después el puesto principal, después el deducido
  const role =
    chosen ??
    targetRoles[0] ??
    defaultRole({
      headline: data.headline,
      allowedDisciplines: data.allowedDisciplines,
      defaultDisciplines: DEFAULT_CRITERIA_RULES.allowed_disciplines,
    });

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Mis skills</h1>
        <p className="text-sm text-zinc-600">
          Contá qué tanto usaste cada una. Con tus niveles, el mercado y el plan muestran lo que te
          falta de verdad.
        </p>
      </div>

      {guardado ? (
        <p role="status" className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          Guardado. Tu mercado y tu plan se actualizan en unos segundos.
        </p>
      ) : null}

      <SkillsForm
        action={saveSkillsAction}
        selectedRoles={targetRoles}
        basePath="/settings/skills"
        roleMap={ROLE_SKILLS}
        role={role}
        taxonomy={data.taxonomy}
        levels={data.levels}
        englishCefr={data.englishCefr}
        customSkills={data.customSkills}
        submitLabel="Guardar"
        withAssistant
      />

      <Link href="/settings" className="text-sm text-zinc-900 underline">
        Volver a Ajustes
      </Link>
    </div>
  );
}
