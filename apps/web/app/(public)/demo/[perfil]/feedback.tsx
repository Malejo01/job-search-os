"use client";

import { useState } from "react";

/** 👍/👎 de prueba (ronda 74): solo cambia el estado local, no guarda nada. */
const BUTTON =
  "inline-flex min-h-11 min-w-11 items-center justify-center rounded-control border px-3 text-base focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

export function Feedback({ title }: { title: string }) {
  const [choice, setChoice] = useState<"up" | "down" | null>(null);
  return (
    <div className="flex flex-col gap-1">
      <div
        className="flex items-center gap-2"
        role="group"
        aria-label="¿Qué te pareció esta evaluación?"
      >
        <button
          type="button"
          aria-pressed={choice === "up"}
          aria-label={`Me sirvió la evaluación de ${title}`}
          onClick={() => setChoice("up")}
          className={`${BUTTON} ${choice === "up" ? "border-brand bg-brand text-brand-contrast" : "border-line-strong bg-surface text-fg hover:bg-surface-muted"}`}
        >
          <span aria-hidden="true">👍</span>
        </button>
        <button
          type="button"
          aria-pressed={choice === "down"}
          aria-label={`No me sirvió la evaluación de ${title}`}
          onClick={() => setChoice("down")}
          className={`${BUTTON} ${choice === "down" ? "border-brand bg-brand text-brand-contrast" : "border-line-strong bg-surface text-fg hover:bg-surface-muted"}`}
        >
          <span aria-hidden="true">👎</span>
        </button>
      </div>
      <p role="status" className="text-xs text-fg-muted">
        {choice ? "En la app, esto ajusta tus próximas evaluaciones. Acá no se guarda nada." : null}
      </p>
    </div>
  );
}
