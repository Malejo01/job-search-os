"use client";

import { FieldError, ProfileForm, useProfileError } from "@/components/profile-form";
import {
  RolePicker,
  type RolePickerGroup,
  type RolePickerSalaries,
} from "@/components/role-picker";
import { saveOnboardingAction } from "./actions";

/** Puestos del paso 1: van arriba de los campos del perfil y comparten su manejo de errores. */
function RolesSection({
  roleGroups,
  salaries,
  selectedRoles,
  rolesLimit,
  defaultRolesLimit,
}: {
  roleGroups: RolePickerGroup[];
  salaries?: RolePickerSalaries | undefined;
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
        Elegí hasta {rolesLimit}. Te mostramos primero las ofertas de esos puestos. Además de
        tecnología, hay carreras digitales: marketing, producto, recruiting IT, customer success y
        ciberseguridad.
      </p>
      <RolePicker
        name="targetRoles"
        selected={selectedRoles}
        limit={rolesLimit}
        defaultLimit={defaultRolesLimit}
        groups={roleGroups}
        salaries={salaries}
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
    >
      <RolesSection
        roleGroups={roleGroups}
        salaries={salaries}
        selectedRoles={selectedRoles}
        rolesLimit={rolesLimit}
        defaultRolesLimit={defaultRolesLimit}
      />
    </ProfileForm>
  );
}
