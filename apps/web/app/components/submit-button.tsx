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
}: {
  children: ReactNode;
  pendingLabel: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
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
