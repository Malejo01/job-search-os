import { THEME_SCRIPT_SOURCE } from "@/lib/theme-script-source";

export {
  DEFAULT_THEME,
  THEME_STORAGE_KEY,
  THEME_VALUES,
  type ThemePreference,
} from "@/lib/theme-script-source";

/**
 * Tema claro u oscuro (N3-2). Pone la clase `dark` en `<html>` antes de pintar, para que no haya
 * destello de claro al cargar. Va inline en el `<head>` del layout raíz; la CSP lo autoriza por su
 * hash (`lib/csp.ts`), así que cualquier cambio del texto actualiza el hash solo.
 */
export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT_SOURCE }} />;
}
