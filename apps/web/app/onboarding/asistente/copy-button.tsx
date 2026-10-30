"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Copia un texto al portapapeles; si el navegador lo niega, avisa y el texto sigue seleccionable.
 * Sin props extra copia «la dirección» (botón «Copiar»); con `label` y `ariaLabel` sirve para
 * palabras. El resultado se anuncia en una región `status`, porque el `aria-label` del botón es fijo.
 */
export function CopyButton({
  text,
  label = "Copiar",
  ariaLabel,
}: {
  text: string;
  label?: string;
  ariaLabel?: string;
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const show = (next: "copied" | "failed") => {
    setState(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 2000);
  };
  return (
    <>
      <button
        type="button"
        aria-label={ariaLabel}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            show("copied");
          } catch {
            show("failed");
          }
        }}
        className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-control border border-line-strong px-3 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
      >
        {state === "copied" ? "Copiado" : state === "failed" ? "No se pudo copiar" : label}
      </button>
      <span role="status" className="sr-only">
        {state === "copied" ? "Copiado" : state === "failed" ? "No se pudo copiar" : ""}
      </span>
    </>
  );
}
