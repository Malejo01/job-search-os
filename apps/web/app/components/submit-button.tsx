"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

/**
 * Botón de envío que se deshabilita mientras la acción del formulario corre: evita el doble clic
 * (cuenta duplicada, fuente duplicada). Tiene que ir dentro del `<form>`.
 */
export function SubmitButton({
  children,
  pendingLabel,
  className,
  pending: pendingOverride,
}: {
  children: ReactNode;
  pendingLabel: string;
  className?: string;
  /** Para formularios que se envían a mano (onSubmit + transición): `useFormStatus` no se entera. */
  pending?: boolean;
}) {
  const status = useFormStatus();
  const pending = pendingOverride ?? status.pending;
  return (
    <button
      type="submit"
      disabled={pending}
      aria-disabled={pending}
      className={`${className ?? ""} disabled:cursor-not-allowed disabled:opacity-60`.trim()}
    >
      {pending ? pendingLabel : children}
    </button>
  );
}
