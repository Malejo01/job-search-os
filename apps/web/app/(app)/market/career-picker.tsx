import { ROLE_KEYS, type RoleKey } from "@job-search-os/pipeline";
import { betaFirst, catalogLabel } from "@/lib/career-names";
import { buttonClasses, inputClasses } from "@/components/ui";

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
  const { beta, others } = betaFirst(
    ROLE_KEYS.filter((k) => visible.includes(k) || k === current || k === tab),
  );
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
            className={inputClasses({ className: "sm:w-auto" })}
          >
            {current ? null : (
              <option value="" disabled>
                Elegí una carrera
              </option>
            )}
            {/* R5-C8: las 8 carreras de la beta primero, con su nombre; el resto, en «Otras» */}
            {beta.length > 0 ? (
              <optgroup label="Carreras de la beta">
                {beta.map((key) => (
                  <option key={key} value={key}>
                    {catalogLabel(key)}
                  </option>
                ))}
              </optgroup>
            ) : null}
            {others.length > 0 ? (
              <optgroup label="Otras carreras">
                {others.map((key) => (
                  <option key={key} value={key}>
                    {catalogLabel(key)}
                  </option>
                ))}
              </optgroup>
            ) : null}
          </select>
        </label>
        <button
          type="submit"
          className={buttonClasses({ variant: "secondary", className: "w-full sm:w-auto" })}
        >
          Ver mercado
        </button>
      </div>
    </form>
  );
}
