import { selectedSpecialtyIds, specialtiesFor, type RoleKey } from "@job-search-os/pipeline";
import type { ReactNode } from "react";
import { RoleSpecialties } from "./specialty-chips";

/**
 * Paneles de áreas por carrera para el selector de puestos (R26-06). Server Component: arma en el
 * servidor lo que antes armaba el selector en el navegador, así el catálogo de áreas (frases de
 * título, ejemplos) no viaja en el JavaScript de la pantalla. Solo hay entrada para las carreras que
 * tienen áreas; el selector muestra el panel cuando la persona marca la carrera.
 *
 * `specialtySelection`: áreas guardadas por carrera (`profiles.target_specialties`); null o ausente =
 * «Todas las áreas». No se valida acá: `selectedSpecialtyIds` ignora lo que no sea del catálogo.
 */
export function specialtyPanelsFor(
  groups: readonly { roles: readonly { key: string; label: string }[] }[],
  specialtySelection: unknown,
  areasFilter: boolean,
): Record<string, ReactNode> {
  const panels: Record<string, ReactNode> = {};
  for (const group of groups) {
    for (const role of group.roles) {
      const key = role.key as RoleKey;
      if (specialtiesFor(key).length === 0) continue;
      panels[role.key] = (
        <RoleSpecialties
          roleKey={key}
          roleLabel={role.label}
          areasFilter={areasFilter}
          initialSpecialties={selectedSpecialtyIds(specialtySelection, key) ?? undefined}
        />
      );
    }
  }
  return panels;
}
