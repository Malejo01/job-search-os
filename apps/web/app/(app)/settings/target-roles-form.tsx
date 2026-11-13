import {
  areasFilterEnabled,
  profileRoleGroups,
  specialtiesFor,
  TARGET_ROLES_DEFAULT_LIMIT,
  type RoleKey,
} from "@job-search-os/pipeline";
import { HelpTip } from "@/components/help-tip";
import { FieldError, GuardedForm, PendingSubmit } from "@/app/components/guarded-form";
import { RolePickerWithProposal } from "@/components/role-picker-with-proposal";
import { catalogLabel } from "@/lib/career-names";
import { Alert, buttonClasses, cardClasses } from "@/components/ui";
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
    roles: group.roles.map((key) => ({ key, label: catalogLabel(key) })),
  }));
  return (
    <section
      id="puesto"
      className={cardClasses({ padding: "md", className: "flex scroll-mt-4 flex-col gap-3" })}
    >
      <h2 className="text-heading font-bold">Tus puestos</h2>
      <p data-testid="current-roles" className="text-sm text-fg-muted">
        {current.length > 0
          ? `Tus puestos actuales: ${current.map((key) => catalogLabel(key)).join(", ")}`
          : "Todavía no elegiste puesto"}
      </p>
      {status === "guardado" ? (
        <Alert tone="success" role="status">
          Guardado. Tus ofertas se actualizan con tus puestos.
        </Alert>
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
        {/* C8-6: qué son las áreas, solo si alguna carrera las tiene */}
        {current.some((r) => specialtiesFor(r).length > 0) ? <HelpTip topic="areas" /> : null}
        <FieldError name="targetRoles" />
        <PendingSubmit className={buttonClasses({ className: "self-start" })}>
          Guardar puestos
        </PendingSubmit>
      </GuardedForm>
    </section>
  );
}
