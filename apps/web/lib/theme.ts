import {
  DEFAULT_THEME,
  THEME_STORAGE_KEY,
  THEME_VALUES,
  type ThemePreference,
} from "@/app/theme-script";

/**
 * Tema claro u oscuro en el navegador (C7-1; compartido desde C10 por «Apariencia» de Ajustes y el
 * botón de la barra). Guarda la preferencia en el mismo `localStorage` que lee `theme-script.tsx`
 * antes de pintar y la aplica en el momento. Solo se usa desde client components.
 */
const CHANGE_EVENT = "jso-tema";

function prefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function apply(theme: ThemePreference): void {
  const dark = theme === "oscuro" || (theme === "sistema" && prefersDark());
  document.documentElement.classList.toggle("dark", dark);
}

/** Cambios desde esta pestaña (evento propio), desde otra (`storage`) o del dispositivo. */
export function subscribeTheme(onChange: () => void): () => void {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  media.addEventListener("change", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
    media.removeEventListener("change", onChange);
  };
}

/** La preferencia guardada (`sistema` si no hay o no se puede leer). */
export function readTheme(): ThemePreference {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    return (THEME_VALUES as readonly string[]).includes(value ?? "")
      ? (value as ThemePreference)
      : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

/** ¿Se está viendo en oscuro ahora? (lo que puso el script del `<head>` o el último cambio). */
export function isDarkNow(): boolean {
  return document.documentElement.classList.contains("dark");
}

export function setTheme(next: ThemePreference): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    // Sin localStorage (modo privado estricto) el cambio vale hasta recargar
  }
  apply(next);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}
