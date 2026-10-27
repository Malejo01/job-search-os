"use client";

/** «Guardar como PDF»: abre la impresión del navegador; el PDF que genera conserva la capa de texto. */
export function PrintButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex min-h-11 items-center rounded-md border border-zinc-300 px-4 py-2 text-base font-medium text-zinc-900 hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900"
    >
      {label}
    </button>
  );
}
