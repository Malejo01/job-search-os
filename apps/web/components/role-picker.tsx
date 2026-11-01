"use client";

import { selectedSpecialtyIds, specialtiesFor, type RoleKey } from "@job-search-os/pipeline";
import { useId, useState } from "react";
import { CareerSalary, type CareerSalaryView } from "./career-salary";
import { RoleSpecialties } from "./specialty-chips";

export type RolePickerSalaries = Partial<Record<RoleKey, CareerSalaryView>>;

export type RolePickerGroup = {
  label: string;
  roles: { key: string; label: string }[];
};

/**
 * Una línea para distinguir las cuatro carreras de producto (ronda 97) y las dos de tecnología que
 * se parecen a otras (ronda 106); las demás no la llevan.
 */
const ROLE_HELP: Readonly<Record<string, string>> = {
  product_manager: "Estrategia y roadmap del producto",
  product_owner: "Backlog y prioridades de un equipo",
  project_manager: "Planificación, plazos y Scrum",
  product_marketing: "Lanzamiento y posicionamiento",
  data_engineer: "Pipelines y plataformas de datos",
  solutions_engineer: "Demos y arquitectura con clientes",
  ventas_b2b: "Prospección y cierre con empresas",
  atencion_cliente: "Soporte a clientes por chat, mail o teléfono; no es IT",
  rrhh_it: "Recruiting y RRHH, IT o no",
  finanzas_contabilidad: "Contabilidad, pagos, impuestos y reportes",
  asistencia_operaciones: "Agenda, correo, carga de datos y coordinación; no es DevOps",
};

/**
 * Selector de puestos (ronda 45): casillas agrupadas con un tope por plan. El contador y el
 * deshabilitado son interacción real, por eso es de cliente. Sin JS se ve y se envía igual: el
 * servidor valida (`parseTargetRoles`) y es quien manda.
 */
export function RolePicker({
  name = "targetRoles",
  selected,
  limit,
  groups,
  defaultLimit,
  salaries,
  spanishCounts,
  specialtySelection,
}: {
  /**
   * Áreas guardadas por carrera (`profiles.target_specialties`, C3-3); null o ausente = «Todas las
   * áreas». El selector no la valida: `selectedSpecialtyIds` ignora lo que no sea del catálogo.
   */
  specialtySelection?: unknown;
  /** Ofertas en español por puesto (30 días); sin esto, el selector no muestra «en español: N». */
  spanishCounts?: Partial<Record<RoleKey, number>> | undefined;
  /** Sueldos del pool por puesto (ronda 80); sin esto, el selector no muestra nada de sueldos. */
  salaries?: RolePickerSalaries | undefined;
  name?: string;
  selected: readonly string[];
  limit: number;
  /** Tope del plan gratis: si `limit` es otro, el contador no habla del plan gratis. */
  defaultLimit: number;
  groups: RolePickerGroup[];
}) {
  const [chosen, setChosen] = useState<ReadonlySet<string>>(() => new Set(selected));
  const noteId = useId();
  const atLimit = chosen.size >= limit;

  function toggle(key: string, checked: boolean) {
    setChosen((prev) => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {groups.map((group) => (
        <fieldset key={group.label} className="flex flex-col gap-1 text-sm">
          <legend className="mb-1 text-xs font-medium text-fg-subtle">{group.label}</legend>
          <div className="grid gap-1 sm:grid-cols-2">
            {group.roles.map((role) => {
              const checked = chosen.has(role.key);
              const disabled = atLimit && !checked;
              const salary = salaries?.[role.key as RoleKey];
              const spanish = spanishCounts?.[role.key as RoleKey];
              const help = ROLE_HELP[role.key];
              const helpId = `${noteId}-help-${role.key}`;
              const specialties = specialtiesFor(role.key as RoleKey);
              const hasSpecialties = specialties.length > 0;
              const describedBy = [help ? helpId : null, disabled ? noteId : null]
                .filter(Boolean)
                .join(" ");
              return (
                <div
                  key={role.key}
                  className={`flex min-w-0 flex-col rounded-card border border-line ${
                    disabled ? "text-fg-subtle" : "text-fg"
                  } ${checked && hasSpecialties ? "sm:col-span-2" : ""}`}
                >
                  <label className="flex min-h-11 items-center gap-2 px-3 py-2">
                    <input
                      type="checkbox"
                      name={name}
                      value={role.key}
                      checked={checked}
                      disabled={disabled}
                      aria-describedby={describedBy || undefined}
                      onChange={(e) => toggle(role.key, e.target.checked)}
                      className="h-4 w-4 shrink-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                    />
                    {role.label}
                  </label>
                  {help ? (
                    <p id={helpId} className="pb-2 pl-9 pr-3 text-xs text-fg-subtle">
                      {help}
                    </p>
                  ) : null}
                  {spanish !== undefined ? (
                    <p
                      className="pb-1 pl-9 pr-3 text-xs text-fg-subtle"
                      data-testid={`career-spanish-${role.key}`}
                      data-count={spanish}
                    >
                      en español: {spanish}
                    </p>
                  ) : null}
                  {/* Fuera del label: abrir "Ver sueldos" no tiene que marcar el puesto */}
                  {salary ? (
                    <div className="px-3 pb-1">
                      <CareerSalary
                        salary={salary}
                        label={role.label}
                        testId={`career-salary-${role.key}`}
                      />
                    </div>
                  ) : null}
                  {checked && hasSpecialties ? (
                    <div className="border-t border-line p-3">
                      <RoleSpecialties
                        roleKey={role.key as RoleKey}
                        roleLabel={role.label}
                        initialSpecialties={
                          selectedSpecialtyIds(specialtySelection, role.key as RoleKey) ?? undefined
                        }
                      />
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </fieldset>
      ))}
      <p aria-live="polite" className="text-xs text-fg-muted" data-testid="role-picker-count">
        {chosen.size} de {limit}
        {limit === defaultLimit ? " en el plan gratis" : ""}
      </p>
      <p id={noteId} className="text-xs text-fg-subtle" hidden={!atLimit}>
        Más puestos con un plan pago (próximamente)
      </p>
    </div>
  );
}
