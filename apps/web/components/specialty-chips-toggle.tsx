"use client";

import type { RoleSpecialty } from "@job-search-os/pipeline";
import { useState } from "react";

/**
 * Selector interactivo de áreas de especialidad (R2-2).
 * Client component chico solo para manejar el toggle de chips.
 * «Todas las áreas» marcado por defecto (todo incluido).
 */
export function SpecialtyChipsToggle({
  roleKey,
  roleLabel,
  specialties,
  initialSelected,
  onChange,
}: {
  roleKey: string;
  roleLabel: string;
  specialties: readonly RoleSpecialty[];
  initialSelected?: readonly string[] | undefined;
  onChange?: ((selected: readonly string[]) => void) | undefined;
}) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => {
    if (initialSelected && initialSelected.length > 0) {
      return new Set(initialSelected);
    }
    // Por defecto todas las áreas marcadas
    return new Set(specialties.map((s) => s.id));
  });

  const isAllSelected = selected.size === specialties.length;

  function selectAll() {
    const next = new Set(specialties.map((s) => s.id));
    setSelected(next);
    onChange?.([...next]);
  }

  function toggle(id: string) {
    setSelected((prev) => {
      let next: Set<string>;
      if (prev.size === specialties.length) {
        // Si estaban todas seleccionadas, al tocar una se pasa a elegir solo esa
        next = new Set([id]);
      } else if (prev.has(id)) {
        next = new Set(prev);
        next.delete(id);
        // Si no quedó ninguna, vuelve a todas por defecto
        if (next.size === 0) {
          next = new Set(specialties.map((s) => s.id));
        }
      } else {
        next = new Set(prev);
        next.add(id);
      }
      onChange?.([...next]);
      return next;
    });
  }

  return (
    <div role="group" aria-label={`Áreas de ${roleLabel}`} className="grid gap-1.5 sm:grid-cols-2">
      {/* Opción «Todas las áreas» (marcada por defecto) */}
      <button
        type="button"
        role="checkbox"
        aria-checked={isAllSelected}
        onClick={selectAll}
        data-testid={`specialty-all-${roleKey}`}
        className={`flex min-h-11 flex-col items-start justify-center gap-1 rounded-control border p-2.5 text-left transition-colors sm:col-span-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${
          isAllSelected
            ? "border-line-strong bg-surface text-fg shadow-xs"
            : "border-line bg-surface-subtle text-fg-muted hover:border-line-strong hover:bg-surface"
        }`}
      >
        <div className="flex w-full items-center justify-between gap-2">
          <span
            className={`text-xs ${
              isAllSelected ? "font-semibold text-fg" : "font-medium text-fg-muted"
            }`}
          >
            Todas las áreas
          </span>
          {isAllSelected ? (
            <span className="shrink-0 rounded-badge border border-line bg-surface-muted px-1.5 py-0.5 text-[11px] font-medium text-fg">
              por defecto
            </span>
          ) : null}
        </div>
        <span className="text-[11px] leading-tight text-fg-subtle">
          Incluye todos los avisos de la carrera
        </span>
      </button>

      {/* Chips individuales de especialidad */}
      {specialties.map((chip) => {
        const isChecked = selected.has(chip.id);
        return (
          <button
            key={chip.id}
            type="button"
            role="checkbox"
            aria-checked={isChecked}
            onClick={() => toggle(chip.id)}
            data-testid={`specialty-chip-${roleKey}-${chip.id}`}
            className={`flex min-h-11 flex-col items-start justify-center gap-1 rounded-control border p-2.5 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${
              isChecked
                ? "border-line-strong bg-surface text-fg shadow-xs"
                : "border-line bg-surface-subtle text-fg-muted hover:border-line-strong hover:bg-surface"
            }`}
          >
            <div className="flex w-full items-center justify-between gap-2">
              <span
                className={`text-xs ${
                  isChecked ? "font-semibold text-fg" : "font-medium text-fg-muted"
                }`}
              >
                {chip.label}
              </span>
              {chip.rare ? (
                <span className="shrink-0 rounded-badge border border-line bg-surface-muted px-1.5 py-0.5 text-[11px] text-fg-subtle">
                  te avisamos si aparece
                </span>
              ) : null}
            </div>
            {chip.examples && chip.examples.length > 0 ? (
              <span className="text-[11px] leading-tight text-fg-subtle">
                {chip.examples.join(", ")}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
