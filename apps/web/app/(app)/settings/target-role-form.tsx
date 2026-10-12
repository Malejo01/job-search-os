import { OTHER_ROLE, ROLE_GROUPS, type RoleKey } from "@job-search-os/pipeline";
import { ROLE_SKILLS } from "@/lib/skill-levels";
import { saveTargetRoleAction } from "./actions";

/**
 * «Tu puesto» (ronda 41): el mismo selector del paso 1, para cambiarlo después. Server Component
 * con un formulario común; la validación y la reasignación viven en `saveTargetRoleAction`.
 */
export function TargetRoleForm({
  current,
  status,
}: {
  current: RoleKey | null;
  status?: "guardado" | "error";
}) {
  return (
    <section
      id="puesto"
      className="flex flex-col gap-3 rounded-md border border-zinc-200 p-4 scroll-mt-4"
    >
      <h2 className="text-lg font-medium">Tu puesto</h2>
      {status === "guardado" ? (
        <p role="status" className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          Guardado. Tus ofertas se actualizan con el puesto nuevo.
        </p>
      ) : null}
      {status === "error" ? (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          No se pudo guardar el puesto. Elegí uno de la lista y volvé a intentar.
        </p>
      ) : null}
      <form action={saveTargetRoleAction} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          ¿Qué puesto buscás?
          <select
            name="targetRole"
            defaultValue={current ?? OTHER_ROLE}
            className="rounded-md border border-zinc-300 px-3 py-2 text-base"
          >
            {ROLE_GROUPS.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.roles.map((key) => (
                  <option key={key} value={key}>
                    {ROLE_SKILLS[key].label}
                  </option>
                ))}
              </optgroup>
            ))}
            <option value={OTHER_ROLE}>Otro o varios</option>
          </select>
          <span className="text-xs text-zinc-600">
            Con esto te mostramos primero las ofertas de ese puesto.
          </span>
        </label>
        <button
          type="submit"
          className="self-start rounded-md bg-zinc-900 px-4 py-2 text-base font-medium text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900"
        >
          Guardar puesto
        </button>
      </form>
    </section>
  );
}
