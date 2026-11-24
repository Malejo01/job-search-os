"use client";

import { PROFILE_AGENT_STORAGE_KEYS, onboardingGuidePrefill } from "@job-search-os/pipeline";
import { useMemo, useSyncExternalStore, type ReactNode } from "react";
import { FieldError, ProfileForm, useProfileError } from "@/components/profile-form";
import type { ProfileFormValues } from "@/lib/onboarding";
import {
  RolePicker,
  type RolePickerGroup,
  type RolePickerSalaries,
} from "@/components/role-picker";
import { saveOnboardingAction } from "./actions";

/**
 * Lo que el agente de perfil dejó en `sessionStorage` (el estado de la guía: país y modalidades), como un
 * solo texto: `useSyncExternalStore` lo compara por valor y en el servidor devuelve el vacío. Nada de esto
 * viaja ni se guarda: solo precarga el formulario, que valida y guarda con su propia acción. El resumen del
 * cierre ya no pasa por el navegador (R11-1): el resumen precargado es el que ya está guardado en el perfil
 * (`agentInitial`, leído en el servidor); el nuevo se ve en la vista previa y se copia a mano.
 */
const EMPTY_STORAGE = JSON.stringify([null]);
const subscribeNothing = (): (() => void) => () => {};
const serverAgentStorage = (): string => EMPTY_STORAGE;
function readAgentStorage(): string {
  try {
    return JSON.stringify([window.sessionStorage.getItem(PROFILE_AGENT_STORAGE_KEYS.state)]);
  } catch {
    return EMPTY_STORAGE;
  }
}

/**
 * País y modalidades de la guía, leídos del estado del agente sin zod (R26-06: el esquema completo
 * sumaba ~25 kB al JavaScript de esta pantalla). Solo precarga el formulario, que la acción vuelve a
 * validar al guardar; igual, un valor que no es del catálogo (país fuera de la lista, modalidad rara,
 * más de 3) se ignora, no se cuela: falla cerrado hacia «lo guardado».
 */
/** Las mismas tres de `MODALITIES` (pipeline); acá a mano para no traer su módulo al navegador. */
const GUIDE_MODALITIES: readonly string[] = ["remoto", "hibrido", "presencial"];

function readGuide(
  raw: unknown,
  countryCodes: readonly string[],
): { country?: string; modalities?: readonly string[] } | null {
  if (typeof raw !== "object" || raw === null) return null;
  const guide = (raw as { guide?: unknown }).guide;
  if (typeof guide !== "object" || guide === null) return null;
  const { country, modalities } = guide as { country?: unknown; modalities?: unknown };
  const out: { country?: string; modalities?: readonly string[] } = {};
  if (typeof country === "string" && country !== "XX" && countryCodes.includes(country)) {
    out.country = country;
  }
  if (
    Array.isArray(modalities) &&
    modalities.length <= 3 &&
    modalities.every((m): m is string => typeof m === "string" && GUIDE_MODALITIES.includes(m))
  ) {
    out.modalities = modalities;
  }
  return out;
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
  specialtyPanels,
  rolesLimit,
  defaultRolesLimit,
}: {
  roleGroups: RolePickerGroup[];
  salaries?: RolePickerSalaries | undefined;
  spanishCounts?: Partial<Record<string, number>> | undefined;
  selectedRoles: readonly string[];
  specialtyPanels?: Readonly<Record<string, ReactNode>> | undefined;
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
        {groupsText(roleGroups.filter((g) => !g.beta).map((g) => g.label))}.
      </p>
      <RolePicker
        name="targetRoles"
        selected={selectedRoles}
        limit={rolesLimit}
        defaultLimit={defaultRolesLimit}
        groups={roleGroups}
        salaries={salaries}
        spanishCounts={spanishCounts}
        specialtyPanels={specialtyPanels}
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
  specialtyPanels,
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
  /** Paneles de áreas por carrera, armados en el servidor (`specialtyPanelsFor`, R26-06). */
  specialtyPanels?: Readonly<Record<string, ReactNode>> | undefined;
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
  // El agente deja el país y las modalidades de la guía en el navegador (todavía no se escriben); se leen
  // una vez, al montar, y precargan el formulario. Sin `agentInitial` no hace nada.
  const stored = useSyncExternalStore(subscribeNothing, readAgentStorage, serverAgentStorage);
  const initial = useMemo((): ProfileFormValues | undefined => {
    if (!agentInitial) return undefined;
    try {
      const [stateRaw] = JSON.parse(stored) as [string | null];
      const guide = readGuide(JSON.parse(stateRaw ?? "null"), countryCodes);
      const prefill = onboardingGuidePrefill(guide, {
        country: agentInitial.country,
      });
      return { ...agentInitial, ...prefill };
    } catch {
      // un estado roto en el navegador: queda lo guardado
      return agentInitial;
    }
  }, [agentInitial, stored, countryCodes]);
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
        specialtyPanels={specialtyPanels}
        rolesLimit={rolesLimit}
        defaultRolesLimit={defaultRolesLimit}
      />
    </ProfileForm>
  );
}
