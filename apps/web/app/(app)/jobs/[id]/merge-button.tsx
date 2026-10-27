"use client";

import { mergeDuplicateAction } from "./actions";

/** "Fusionar" con confirmación (JS-025): borra una de las dos ofertas, sus fuentes pasan a la otra. */
export function MergeButton({ jobId, otherTitle }: { jobId: string; otherTitle: string }) {
  return (
    <form
      action={mergeDuplicateAction}
      onSubmit={(e) => {
        const ok = window.confirm(
          `¿Fusionar con "${otherTitle}"? Queda una sola oferta con las fuentes de las dos; ninguna descripción se pierde.`,
        );
        if (!ok) e.preventDefault();
      }}
    >
      <input type="hidden" name="jobId" value={jobId} />
      <button
        type="submit"
        className="rounded-control border border-warning-strong bg-warning-strong px-3 py-2 text-sm text-on-strong"
      >
        Fusionar
      </button>
    </form>
  );
}
