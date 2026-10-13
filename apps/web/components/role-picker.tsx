"use client";

import { useId, useState } from "react";

export type RolePickerGroup = {
  label: string;
  roles: { key: string; label: string }[];
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
}: {
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
          <legend className="mb-1 text-xs font-medium text-zinc-600">{group.label}</legend>
          <div className="grid gap-1 sm:grid-cols-2">
            {group.roles.map((role) => {
              const checked = chosen.has(role.key);
              const disabled = atLimit && !checked;
              return (
                <label
                  key={role.key}
                  className={`flex min-h-11 items-center gap-2 rounded-md border border-zinc-200 px-3 py-2 ${
                    disabled ? "text-zinc-500" : "text-zinc-900"
                  }`}
                >
                  <input
                    type="checkbox"
                    name={name}
                    value={role.key}
                    checked={checked}
                    disabled={disabled}
                    aria-describedby={disabled ? noteId : undefined}
                    onChange={(e) => toggle(role.key, e.target.checked)}
                    className="h-4 w-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900"
                  />
                  {role.label}
                </label>
              );
            })}
          </div>
        </fieldset>
      ))}
      <p aria-live="polite" className="text-xs text-zinc-700" data-testid="role-picker-count">
        {chosen.size} de {limit}
        {limit === defaultLimit ? " en el plan gratis" : ""}
      </p>
      <p id={noteId} className="text-xs text-zinc-600" hidden={!atLimit}>
        Más puestos con un plan pago (próximamente)
      </p>
    </div>
  );
}
