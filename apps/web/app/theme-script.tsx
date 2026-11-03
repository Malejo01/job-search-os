/**
 * Tema claro u oscuro (N3-2). Pone la clase `dark` en `<html>` antes de pintar, para que no haya
 * destello de claro al cargar. Va inline en el `<head>` del layout raíz; no hay CSP de scripts
 * (next.config.ts solo fija `frame-ancestors`): si se suma, este script necesita su hash o un nonce.
 *
 * Preferencia en `localStorage["jso-tema"]`: `"claro"`, `"oscuro"` o `"sistema"` (sigue a
 * `prefers-color-scheme`). Sin preferencia vale `DEFAULT_THEME`.
 *
 * `DEFAULT_THEME` es `"sistema"` desde C7-1: todas las pantallas usan tokens, así que sin
 * preferencia guardada la app sigue al dispositivo. La preferencia se cambia en Ajustes
 * (`settings/theme-select.tsx`).
 */
export const THEME_STORAGE_KEY = "jso-tema";
export const THEME_VALUES = ["sistema", "claro", "oscuro"] as const;
export type ThemePreference = (typeof THEME_VALUES)[number];
export const DEFAULT_THEME: ThemePreference = "sistema";

// Con «sistema», además escucha el cambio del dispositivo (p. ej. el modo oscuro automático de noche)
const SCRIPT = `(function(){try{var k=${JSON.stringify(THEME_STORAGE_KEY)},m=matchMedia("(prefers-color-scheme: dark)");function a(){var t=localStorage.getItem(k)||${JSON.stringify(DEFAULT_THEME)};document.documentElement.classList.toggle("dark",t==="oscuro"||(t==="sistema"&&m.matches))}a();m.addEventListener("change",a)}catch(e){}})()`;

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: SCRIPT }} />;
}
