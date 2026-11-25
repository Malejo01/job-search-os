import type { ReactNode } from "react";
import { Afi } from "@/components/afi";
import { Logo } from "@/components/brand/logo";
import type { MascotaPose } from "@/lib/mascota";

/**
 * Error que corta toda la pantalla (F1, C9-13, decisión 12; R27-05): la mascota en la pose que pida cada
 * pantalla (`quieto` en el 404, `analizando` en los errores), una frase clara y una salida. Tono sereno
 * (decisión 14): sin chistes ni «Uh». Sirve en Server y en Client Components (no tiene estado). `logo`: en
 * pantallas sin header (404 y error de la raíz). La figura es decorativa: el título ya dice lo que pasa.
 */
export function FullScreenState({
  title,
  children,
  actions,
  logo = false,
  footer,
  pose = "analizando",
}: {
  title: string;
  children: ReactNode;
  /** La salida: una acción principal y, como mucho, una secundaria. */
  actions: ReactNode;
  logo?: boolean;
  footer?: ReactNode;
  pose?: MascotaPose;
}) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-5 px-4 py-12 text-center sm:py-16">
      {logo ? <Logo className="mb-2" /> : null}
      <Afi pose={pose} size={176} decorative priority />
      <h1 className="text-title font-bold text-fg">{title}</h1>
      <div className="text-base text-fg-muted">{children}</div>
      <div className="flex flex-wrap items-center justify-center gap-3">{actions}</div>
      {footer}
    </div>
  );
}
