"use client";

import {
  BETA_GROUP_LABEL,
  PROFILE_AGENT_STORAGE_KEYS,
  parseProfileAgentState,
  profileAgentFormPrefill,
} from "@job-search-os/pipeline";
import { useMemo, useSyncExternalStore } from "react";
import { PROFILE_AGENT_SUMMARY_KEY } from "@/components/profile-agent/onboarding-choice";
import { FieldError, ProfileForm, useProfileError } from "@/components/profile-form";
import type { ProfileFormValues } from "@/lib/onboarding";
import {
  RolePicker,
  type RolePickerGroup,
  type RolePickerSalaries,
} from "@/components/role-picker";
import { saveOnboardingAction } from "./actions";

/**
 * Lo que el agente de perfil dejó en `sessionStorage` (estado de la guía y resumen verificado), como un
 * solo texto: `useSyncExternalStore` lo compara por valor y en el servidor devuelve el vacío. Nada de esto
 * viaja ni se guarda: solo precarga el formulario, que valida y guarda con su propia acción.
 */
const EMPTY_STORAGE = JSON.stringify([null, null]);
const subscribeNothing = (): (() => void) => () => {};
const serverAgentStorage = (): string => EMPTY_STORAGE;
function readAgentStorage(): string {
  try {
    return JSON.stringify([
      window.sessionStorage.getItem(PROFILE_AGENT_STORAGE_KEYS.state),
      window.sessionStorage.getItem(PROFILE_AGENT_SUMMARY_KEY),
    ]);
  } catch {
    return EMPTY_STORAGE;
  }
}

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
  specialtySelection,
  areasFilter,
  rolesLimit,
  defaultRolesLimit,
}: {
  roleGroups: RolePickerGroup[];
  salaries?: RolePickerSalaries | undefined;
  spanishCounts?: Partial<Record<string, number>> | undefined;
  selectedRoles: readonly string[];
  specialtySelection?: unknown;
  areasFilter?: boolean | undefined;
  rolesLimit: number;
  defaultRolesLimit: number;
}) {
  const error = useProfileError();
  return (
    <fieldset
      className="flex flex-col gap-2 text-sm"
      aria-describedby={error?.field === "targetRoles" ? "targetRoles-error" : "roles-help"}
    >
      <legend className="mb-1 font-bold text-fg">¿Qué puestos buscás?</legend>
      <p id="roles-help" className="text-xs text-fg-subtle">
        Elegí hasta {rolesLimit}. Te mostramos primero las ofertas de esos puestos. Arriba están las
        carreras de la beta; también hay de{" "}
        {groupsText(roleGroups.filter((g) => g.label !== BETA_GROUP_LABEL).map((g) => g.label))}.
      </p>
      <RolePicker
        name="targetRoles"
        selected={selectedRoles}
        limit={rolesLimit}
        defaultLimit={defaultRolesLimit}
        groups={roleGroups}
        salaries={salaries}
        spanishCounts={spanishCounts}
        specialtySelection={specialtySelection}
        areasFilter={areasFilter ?? false}
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
  specialtySelection,
  areasFilter,
  rolesLimit,
  defaultRolesLimit,
  countries,
  cefrLevels,
  countryCodes,
  minSummary,
  maxSummary,
  agentInitial,
}: {
  /**
   * Perfil guardado, solo cuando la persona pasó por el agente de perfil (`CV_PROFILE_AGENT`, ADR-034):
   * precarga los campos, editables. Sin él (flag apagado o sin agente) el formulario queda como siempre.
   */
  agentInitial?: ProfileFormValues | undefined;
  roleGroups: RolePickerGroup[];
  /** Sueldos por puesto del pool público; sin ellos el selector no muestra la línea. */
  salaries?: RolePickerSalaries | undefined;
  /** Ofertas en español por puesto; sin ellas no hay «en español: N» ni aviso. */
  spanishCounts?: Partial<Record<string, number>> | undefined;
  selectedRoles: readonly string[];
  /** Áreas ya guardadas por carrera (C3-3); sin ellas, «Todas las áreas». */
  specialtySelection?: unknown;
  /** `AREAS_FILTER_ENABLED` prendido (C5-3): el texto de las áreas dice que las otras bajan y se marcan. */
  areasFilter?: boolean | undefined;
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
  // El agente deja el país y las modalidades de la guía y el resumen verificado en el navegador (todavía
  // no se escriben); se leen una vez, al montar, y precargan el formulario. Sin `agentInitial` no hace nada.
  const stored = useSyncExternalStore(subscribeNothing, readAgentStorage, serverAgentStorage);
  const initial = useMemo((): ProfileFormValues | undefined => {
    if (!agentInitial) return undefined;
    try {
      const [stateRaw, summaryRaw] = JSON.parse(stored) as [string | null, string | null];
      const state = parseProfileAgentState(JSON.parse(stateRaw ?? "null"));
      const prefill = profileAgentFormPrefill(state?.guide ?? null, summaryRaw, {
        country: agentInitial.country,
        summary: agentInitial.summary,
      });
      return { ...agentInitial, ...prefill };
    } catch {
      // un estado roto en el navegador: queda lo guardado
      return agentInitial;
    }
  }, [agentInitial, stored]);
  return (
    <ProfileForm
      // al llegar el precargado el formulario se vuelve a montar: la persona todavía no escribió nada
      key={stored === EMPTY_STORAGE ? "base" : "prefilled"}
      {...(initial ? { initial } : {})}
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
        specialtySelection={specialtySelection}
        areasFilter={areasFilter}
        rolesLimit={rolesLimit}
        defaultRolesLimit={defaultRolesLimit}
      />
    </ProfileForm>
  );
}
