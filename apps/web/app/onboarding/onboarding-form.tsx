"use client";

import { FieldError, ProfileForm, useProfileError } from "@/components/profile-form";
import {
  RolePicker,
  type RolePickerGroup,
  type RolePickerSalaries,
} from "@/components/role-picker";
import { saveOnboardingAction } from "./actions";

/** «A, B y C» con los nombres de los grupos del selector (salen de `ROLE_GROUPS`, no se escriben acá). */
function groupsText(labels: string[]): string {
  const lower = labels.map((l) => l.toLowerCase());
  if (lower.length < 2) return lower.join("");
  return `${lower.slice(0, -1).join(", ")} y ${lower[lower.length - 1]}`;
}

/** Puestos del paso 1: van arriba de los campos del perfil y comparten su manejo de errores. */
function RolesSection({
  roleGroups,
  salaries,
  spanishCounts,
  selectedRoles,
  rolesLimit,
  defaultRolesLimit,
}: {
  roleGroups: RolePickerGroup[];
  salaries?: RolePickerSalaries | undefined;
  spanishCounts?: Partial<Record<string, number>> | undefined;
  selectedRoles: readonly string[];
  rolesLimit: number;
  defaultRolesLimit: number;
}) {
  const error = useProfileError();
  return (
    <fieldset
      className="flex flex-col gap-2 text-sm"
      aria-describedby={error?.field === "targetRoles" ? "targetRoles-error" : "roles-help"}
    >
      <legend className="mb-1">¿Qué puestos buscás?</legend>
      <p id="roles-help" className="text-xs text-zinc-600">
        Elegí hasta {rolesLimit}. Te mostramos primero las ofertas de esos puestos. Hay carreras de{" "}
        {groupsText(roleGroups.map((g) => g.label))}.
      </p>
      <RolePicker
        name="targetRoles"
        selected={selectedRoles}
        limit={rolesLimit}
        defaultLimit={defaultRolesLimit}
        groups={roleGroups}
        salaries={salaries}
        spanishCounts={spanishCounts}
      />
      <FieldError name="targetRoles" />
    </fieldset>
  );
}

/**
 * Paso 1 del onboarding: los puestos arriba y, debajo, los campos del perfil que comparte con
 * «Tu perfil» en Ajustes (`ProfileForm`). Los datos nunca se pierden ante un error.
 */
export function OnboardingForm({
  roleGroups,
  salaries,
  spanishCounts,
  selectedRoles,
  rolesLimit,
  defaultRolesLimit,
  countries,
  cefrLevels,
  countryCodes,
  minSummary,
  maxSummary,
}: {
  roleGroups: RolePickerGroup[];
  /** Sueldos por puesto del pool público; sin ellos el selector no muestra la línea. */
  salaries?: RolePickerSalaries | undefined;
  /** Ofertas en español por puesto; sin ellas no hay «en español: N» ni aviso. */
  spanishCounts?: Partial<Record<string, number>> | undefined;
  selectedRoles: readonly string[];
  rolesLimit: number;
  defaultRolesLimit: number;
  /** Países de LATAM: van primero en el buscador de residencia. */
  countries: readonly { code: string; label: string }[];
  cefrLevels: readonly string[];
  /** Códigos ISO-2 para el buscador de autorización de trabajo (la lista vive en el pipeline). */
  countryCodes: readonly string[];
  minSummary: number;
  maxSummary: number;
}) {
  return (
    <ProfileForm
      action={saveOnboardingAction}
      rolesLimit={rolesLimit}
      countries={countries}
      cefrLevels={cefrLevels}
      countryCodes={countryCodes}
      minSummary={minSummary}
      maxSummary={maxSummary}
      showLimits
      submitLabel="Guardar y continuar"
      selectedRoles={selectedRoles}
      spanishCounts={spanishCounts}
      roleLabels={Object.fromEntries(
        roleGroups.flatMap((g) => g.roles.map((r) => [r.key, r.label] as const)),
      )}
    >
      <RolesSection
        roleGroups={roleGroups}
        salaries={salaries}
        spanishCounts={spanishCounts}
        selectedRoles={selectedRoles}
        rolesLimit={rolesLimit}
        defaultRolesLimit={defaultRolesLimit}
      />
    </ProfileForm>
  );
}
