import { specialtiesFor, type RoleKey } from "@job-search-os/pipeline";
import { SpecialtyChipsToggle } from "./specialty-chips-toggle";

/**
 * Áreas de especialidad de una carrera (R2-2).
 * Server Component por defecto: obtiene las especialidades de la carrera y delega
 * la interactividad al cliente chico `SpecialtyChipsToggle`.
 *
 * Muestra «Todas las áreas» marcado por defecto, con 2 o 3 ejemplos de puesto
 * en lenguaje simple debajo de cada chip, y aviso «te avisamos si aparece»
 * para áreas poco publicadas.
 */
export function RoleSpecialties({
  roleKey,
  roleLabel,
  initialSpecialties,
  areasFilter = false,
}: {
  roleKey: RoleKey;
  roleLabel: string;
  initialSpecialties?: readonly string[] | undefined;
  /**
   * `AREAS_FILTER_ENABLED` prendido (C5-3): las ofertas de otras áreas bajan de orden y se marcan. Apagado
   * (el default), todavía no filtran nada y el texto no puede prometerlo.
   */
  areasFilter?: boolean;
}) {
  const specialties = specialtiesFor(roleKey);
  if (specialties.length === 0) return null;

  return (
    <div
      className="flex flex-col gap-2 rounded-card border border-line bg-surface-subtle p-3"
      data-testid={`role-specialties-${roleKey}`}
    >
      <div className="flex flex-col gap-0.5">
        <p className="text-xs font-semibold text-fg">Áreas de {roleLabel}</p>
        <p className="text-xs text-fg-subtle">
          {areasFilter
            ? "Elegí las áreas que más te interesan. Las ofertas de otras áreas de tu carrera te aparecen más abajo y marcadas: no se esconden."
            : "Elegí las áreas que más te interesan. Por ahora te mostramos todas las ofertas de tu carrera."}
        </p>
      </div>
      <SpecialtyChipsToggle
        roleKey={roleKey}
        roleLabel={roleLabel}
        specialties={specialties}
        initialSelected={initialSpecialties}
      />
    </div>
  );
}
