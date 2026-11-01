import { ROLE_KEYS, type RoleKey } from "@job-search-os/pipeline";
import { ROLE_SKILLS } from "@/lib/skill-levels";

/**
 * "Explorar otra carrera": formulario GET con `?carrera=<clave>`. Conserva la pestaña (`rol`) para
 * que "Tu agenda" siga en el puesto de la persona. Server Component, sin JavaScript en el cliente.
 */
export function CareerPicker({
  current,
  tab,
  visible,
}: {
  current: RoleKey | null;
  /** Puesto de la pestaña activa, si la persona eligió puestos. */
  tab: RoleKey | null;
  /** Carreras que se muestran hoy (`getPublicCareerKeys`, ADR-029). */
  visible: readonly RoleKey[];
}) {
  return (
    <form
      method="get"
      aria-label="Explorar otra carrera"
      className="flex flex-col gap-2 text-xs text-fg-subtle"
    >
      {tab ? <input type="hidden" name="rol" value={tab} /> : null}
      <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:items-end">
        <label className="flex min-w-0 flex-col gap-1">
          Explorar otra carrera
          <select
            name="carrera"
            defaultValue={current ?? ""}
            className="min-h-11 w-full rounded-control border border-line-strong px-2 py-2 text-sm text-fg sm:w-auto"
          >
            {current ? null : (
              <option value="" disabled>
                Elegí una carrera
              </option>
            )}
            {ROLE_KEYS.filter((k) => visible.includes(k) || k === current || k === tab).map(
              (key) => (
                <option key={key} value={key}>
                  {ROLE_SKILLS[key].label}
                </option>
              ),
            )}
          </select>
        </label>
        <button
          type="submit"
          className="min-h-11 w-full rounded-control border border-line-control px-4 py-2 text-sm text-fg sm:w-auto"
        >
          Ver mercado
        </button>
      </div>
    </form>
  );
}
