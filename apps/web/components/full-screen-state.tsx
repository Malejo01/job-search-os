import type { ReactNode } from "react";
import { Logo } from "@/components/brand/logo";
import { Illustration } from "@/components/brand/illustration";

/**
 * Error que corta toda la pantalla (F1, C9-13, decisión 12): la ilustración «error», una frase
 * clara y una salida. Tono sereno (decisión 14): sin chistes ni «Uh». Sirve en Server y en Client
 * Components (no tiene estado). `logo`: en pantallas sin header (404 y error de la raíz).
 */
export function FullScreenState({
  title,
  children,
  actions,
  logo = false,
  footer,
}: {
  title: string;
  children: ReactNode;
  /** La salida: una acción principal y, como mucho, una secundaria. */
  actions: ReactNode;
  logo?: boolean;
  footer?: ReactNode;
}) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-5 px-4 py-12 text-center sm:py-16">
      {logo ? <Logo className="mb-2" /> : null}
      <Illustration escena="error" priority className="w-52 sm:w-72" />
      <h1 className="text-title font-bold text-fg">{title}</h1>
      <div className="text-base text-fg-muted">{children}</div>
      <div className="flex flex-wrap items-center justify-center gap-3">{actions}</div>
      {footer}
    </div>
  );
}
