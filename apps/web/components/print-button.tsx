"use client";

import { buttonClasses } from "@/components/ui";

/** «Guardar como PDF»: abre la impresión del navegador; el PDF que genera conserva la capa de texto. */
export function PrintButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className={buttonClasses({ variant: "secondary" })}
    >
      {label}
    </button>
  );
}
