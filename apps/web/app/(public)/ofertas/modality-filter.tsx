"use client";

import { useState } from "react";

/**
 * Filtro de modalidad de /ofertas (ronda 63). Solo oculta tarjetas ya renderizadas (`hidden` sobre
 * los `li[data-modality]` de la lista `listId`): la página sigue siendo ISR y sin JS se ven todas.
 */
const OPTIONS = [
  ["todas", "Todas"],
  ["remoto", "Remoto"],
  ["hibrido", "Híbrido"],
  ["presencial", "Presencial"],
  ["desconocida", "No informada"],
] as const;

export function ModalityFilter({ listId }: { listId: string }) {
  const [value, setValue] = useState<string>("todas");
  const [shown, setShown] = useState<number | null>(null);

  function choose(next: string) {
    setValue(next);
    const items = document.querySelectorAll<HTMLElement>(`#${listId} > li[data-modality]`);
    let visible = 0;
    items.forEach((el) => {
      const hide = next !== "todas" && el.dataset.modality !== next;
      el.hidden = hide;
      if (!hide) visible += 1;
    });
    setShown(visible);
  }

  return (
    <div className="flex flex-col gap-2">
      <p id={`${listId}-filtro`} className="text-sm font-semibold">
        Modalidad
      </p>
      <div role="group" aria-labelledby={`${listId}-filtro`} className="flex flex-wrap gap-2">
        {OPTIONS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-pressed={value === key}
            onClick={() => choose(key)}
            className={`inline-flex min-h-11 items-center rounded-full border px-3 text-sm ${
              value === key
                ? "border-zinc-900 bg-zinc-900 text-white"
                : "border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-100"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <p role="status" className="text-xs text-zinc-600">
        {shown === null
          ? null
          : shown === 0
            ? "Ninguna de estas ofertas tiene esa modalidad."
            : `Mostrando ${shown} ${shown === 1 ? "oferta" : "ofertas"}.`}
      </p>
    </div>
  );
}
