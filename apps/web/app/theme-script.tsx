/**
 * Tema claro u oscuro (N3-2). Pone la clase `dark` en `<html>` antes de pintar, para que no haya
 * destello de claro al cargar. Va inline en el `<head>` del layout raíz; no hay CSP de scripts
 * (next.config.ts solo fija `frame-ancestors`): si se suma, este script necesita su hash o un nonce.
 *
 * Preferencia en `localStorage["jso-tema"]`: `"claro"`, `"oscuro"` o `"sistema"` (sigue a
 * `prefers-color-scheme`). Sin preferencia vale `DEFAULT_THEME`.
 *
 * `DEFAULT_THEME` es `"claro"` mientras las pantallas se migran a los tokens (docs/ux/tokens.md):
 * una pantalla sin migrar se vería a medias en oscuro. El oscuro se prueba a mano con
 * `localStorage.setItem("jso-tema", "oscuro")`. Cuando estén todas, pasa a `"sistema"`.
 */
export const THEME_STORAGE_KEY = "jso-tema";
export const DEFAULT_THEME = "claro";

const SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)})||${JSON.stringify(DEFAULT_THEME)};var d=t==="oscuro"||(t==="sistema"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d)}catch(e){}})()`;

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: SCRIPT }} />;
}
