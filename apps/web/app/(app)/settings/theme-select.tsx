"use client";

import { useSyncExternalStore } from "react";
import { filterChipClasses } from "@/components/ui";
import {
  DEFAULT_THEME,
  THEME_STORAGE_KEY,
  THEME_VALUES,
  type ThemePreference,
} from "@/app/theme-script";

const LABELS: Record<ThemePreference, string> = {
  sistema: "Como el dispositivo",
  claro: "Claro",
  oscuro: "Oscuro",
};

function prefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function apply(theme: ThemePreference): void {
  const dark = theme === "oscuro" || (theme === "sistema" && prefersDark());
  document.documentElement.classList.toggle("dark", dark);
}

const CHANGE_EVENT = "jso-tema";

// Cambios desde esta pestaña (evento propio) o desde otra (`storage`)
function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function read(): ThemePreference {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    return (THEME_VALUES as readonly string[]).includes(value ?? "")
      ? (value as ThemePreference)
      : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

/**
 * Apariencia (C7-1): claro, oscuro o como el dispositivo. Guarda la preferencia en el mismo
 * `localStorage` que lee `theme-script.tsx` antes de pintar, y la aplica en el momento. Los cambios
 * del dispositivo con «Como el dispositivo» los sigue el script del `<head>`.
 */
export function ThemeSelect() {
  // En el servidor no hay localStorage: se pinta con el valor por defecto y se corrige al hidratar
  const theme = useSyncExternalStore(subscribe, read, () => DEFAULT_THEME);

  function choose(next: ThemePreference) {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Sin localStorage (modo privado estricto) el cambio vale hasta recargar
    }
    apply(next);
    window.dispatchEvent(new Event(CHANGE_EVENT));
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
