import type { ReactNode } from "react";
import PublicLayout from "../(public)/layout";

/**
 * Layout de las páginas legales públicas (JS-106): fuera de (app), sin sesión ni gate de
 * onboarding, para que se puedan leer antes de registrarse. Usa la misma cabecera y pie que el
 * resto del sitio público (R4-09, hallazgo 15). Server Component.
 */
export default function LegalLayout({ children }: { children: ReactNode }) {
  return <PublicLayout>{children}</PublicLayout>;
}
