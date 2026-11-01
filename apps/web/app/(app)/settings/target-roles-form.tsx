import {
  areasFilterEnabled,
  profileRoleGroups,
  TARGET_ROLES_DEFAULT_LIMIT,
  type RoleKey,
} from "@job-search-os/pipeline";
import { FieldError, GuardedForm, PendingSubmit } from "@/app/components/guarded-form";
import { RolePickerWithProposal } from "@/components/role-picker-with-proposal";
import { ROLE_SKILLS } from "@/lib/skill-levels";
import { saveTargetRolesAction } from "./actions";

/**
 * «Tus puestos» (ronda 45): el mismo selector del paso 1, para cambiarlos después. Arriba dice, en
 * texto, qué puestos hay guardados (o que todavía no eligió); el selector arranca con esos marcados
 * y sin nada marcado si no hay. Server Component con un formulario común; la validación, el tope y
 * la reasignación viven en `saveTargetRolesAction`.
 */
export function TargetRolesForm({
  current,
  specialtySelection,
  limit,
  status,
}: {
  current: RoleKey[];
  /** Áreas guardadas por carrera (C3-3); null = «Todas las áreas». */
  specialtySelection?: unknown;
  limit: number;
  status?: "guardado";
}) {
  const groups = profileRoleGroups(current).map((group) => ({
    label: group.label,
    roles: group.roles.map((key) => ({ key, label: ROLE_SKILLS[key].label })),
  }));
  return (
    <section
      id="puesto"
      className="flex flex-col gap-3 rounded-card border border-line p-4 scroll-mt-4"
    >
      <h2 className="text-lg font-medium">Tus puestos</h2>
      <p data-testid="current-roles" className="text-sm text-fg-muted">
        {current.length > 0
          ? `Tus puestos actuales: ${current.map((key) => ROLE_SKILLS[key].label).join(", ")}`
          : "Todavía no elegiste puesto"}
      </p>
      {status === "guardado" ? (
        <p role="status" className="rounded-control bg-success-soft px-3 py-2 text-sm text-success">
          Guardado. Tus ofertas se actualizan con tus puestos.
        </p>
      ) : null}
      <GuardedForm
        action={saveTargetRolesAction}
        messages={{
          targetRoles: `Elegí al menos un puesto (hasta ${limit}) y volvé a guardar. Lo que marcaste sigue ahí.`,
        }}
        className="flex flex-col gap-3"
      >
        <p className="text-xs text-fg-subtle">
          ¿Qué puestos buscás? Elegí hasta {limit}. Te mostramos primero las ofertas de esos
          puestos.
        </p>
        <RolePickerWithProposal
          name="targetRoles"
          selected={current}
          specialtySelection={specialtySelection}
          areasFilter={areasFilterEnabled(process.env)}
          limit={limit}
          defaultLimit={TARGET_ROLES_DEFAULT_LIMIT}
          groups={groups}
        />
        <FieldError name="targetRoles" />
        <PendingSubmit className="self-start rounded-control bg-brand px-4 py-2 text-base font-medium text-brand-contrast focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
          Guardar puestos
        </PendingSubmit>
      </GuardedForm>
    </section>
  );
}
