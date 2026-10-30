"use client";

/** «Guardar como PDF»: abre la impresión del navegador; el PDF que genera conserva la capa de texto. */
export function PrintButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex min-h-11 items-center rounded-control border border-line-strong px-4 py-2 text-base font-medium text-fg hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
    >
      {label}
    </button>
  );
}
