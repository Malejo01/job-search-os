"use client";

import { useSyncExternalStore } from "react";
import { filterChipClasses } from "@/components/ui";
import { DEFAULT_THEME, THEME_VALUES, type ThemePreference } from "@/app/theme-script";
import { readTheme, setTheme, subscribeTheme } from "@/lib/theme";

const LABELS: Record<ThemePreference, string> = {
  sistema: "Como el dispositivo",
  claro: "Claro",
  oscuro: "Oscuro",
};

/**
 * Apariencia (C7-1): claro, oscuro o como el dispositivo. Guarda la preferencia en el mismo
 * `localStorage` que lee `theme-script.tsx` antes de pintar, y la aplica en el momento. Los cambios
 * del dispositivo con «Como el dispositivo» los sigue el script del `<head>`.
 */
export function ThemeSelect() {
  // En el servidor no hay localStorage: se pinta con el valor por defecto y se corrige al hidratar
  const theme = useSyncExternalStore(subscribeTheme, readTheme, () => DEFAULT_THEME);

  function choose(next: ThemePreference) {
    setTheme(next);
  }

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="sr-only">Tema</legend>
      <div className="flex flex-wrap gap-2">
        {THEME_VALUES.map((value) => (
          <label
            key={value}
            // C9-11: píldora de filtro; la elegida (radio marcado) en lima con borde índigo, por CSS
            className={filterChipClasses({
              className:
                "cursor-pointer has-[:checked]:border-brand-contrast has-[:checked]:bg-brand has-[:checked]:text-brand-contrast has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus",
            })}
          >
            <input
              type="radio"
              name="tema"
              value={value}
              checked={theme === value}
              onChange={() => choose(value)}
              className="sr-only"
            />
            {LABELS[value]}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
