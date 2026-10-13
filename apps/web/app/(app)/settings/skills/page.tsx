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

const FIELD_ERRORS: Record<string, string> = {
  niveles: "Hay demasiadas skills en el formulario. Recargá la página y volvé a intentar.",
  slug: "Hay una skill que no se reconoce. Recargá la página y volvé a intentar.",
};

/** Mis skills (ronda 28): niveles autodeclarados que usan el mercado, el plan y el prescore. */
export default async function SkillsSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ rol?: string; guardado?: string; error?: string }>;
}) {
  const userId = await requireUserId();
  const [data, targetRoles, { rol, guardado, error }] = await Promise.all([
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
      {error ? (
        <p
          id="skills-error"
          role="alert"
          className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          {error.startsWith("level:")
            ? "Hay un nivel que no es válido. Recargá la página y volvé a intentar."
            : (FIELD_ERRORS[error] ?? "Revisá los datos del formulario.")}
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
        submitLabel="Guardar"
        invalidSlug={error?.startsWith("level:") ? error.slice("level:".length) : undefined}
      />

      <Link href="/settings" className="text-sm text-zinc-900 underline">
        Volver a Ajustes
      </Link>
    </div>
  );
}
