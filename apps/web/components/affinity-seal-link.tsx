"use client";

import type { ReactNode } from "react";

/** Id del `<details>` del detalle de afinidad (R17-03). */
export const AFFINITY_PANEL_ID = "composicion";

/**
 * En el detalle de la oferta, el sello es un botón que abre el panel «Cómo se compone el puntaje»,
 * baja hasta él y le da el foco. Sin JavaScript no hace nada: el panel igual se abre con su resumen.
 */
export function AffinitySealLink({ children }: { children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label="Ver cómo se compone el puntaje"
      aria-controls={AFFINITY_PANEL_ID}
      className="rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      onClick={() => {
        const panel = document.getElementById(AFFINITY_PANEL_ID);
        if (!(panel instanceof HTMLDetailsElement)) return;
        panel.open = true;
        const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        panel.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
        panel.querySelector("summary")?.focus({ preventScroll: true });
      }}
    >
      {children}
    </button>
  );
}
