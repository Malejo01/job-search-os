/**
 * Preferencia de tema en `localStorage["jso-tema"]`: `"claro"`, `"oscuro"` o `"sistema"` (sigue a
 * `prefers-color-scheme`). Sin preferencia vale `DEFAULT_THEME`.
 *
 * `DEFAULT_THEME` es `"claro"` (R4-02): sin preferencia guardada la app abre en claro aunque el
 * dispositivo esté en oscuro; quien quiere oscuro lo elige con el botón de la barra o en Ajustes
 * (`settings/theme-select.tsx`, donde «Como el dispositivo» sí sigue al sistema).
 */
export const THEME_STORAGE_KEY = "jso-tema";
export const THEME_VALUES = ["sistema", "claro", "oscuro"] as const;
export type ThemePreference = (typeof THEME_VALUES)[number];
export const DEFAULT_THEME: ThemePreference = "claro";

// Con «sistema», además escucha el cambio del dispositivo (p. ej. el modo oscuro automático de noche)
export const THEME_SCRIPT_SOURCE = `(function(){try{var k=${JSON.stringify(THEME_STORAGE_KEY)},m=matchMedia("(prefers-color-scheme: dark)");function a(){var t=localStorage.getItem(k)||${JSON.stringify(DEFAULT_THEME)};document.documentElement.classList.toggle("dark",t==="oscuro"||(t==="sistema"&&m.matches))}a();m.addEventListener("change",a)}catch(e){}})()`;
