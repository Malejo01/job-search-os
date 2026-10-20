"use client";

import { useEffect, useId, useRef, useState } from "react";

/**
 * Botón «¿Qué es?» de una skill (ronda 78): abre en línea una frase que dice qué es y para qué se
 * usa. El panel ocupa su propio renglón (no flota), así no tapa el select ni se sale de la pantalla
 * a 360 px. Se cierra con Escape (el foco vuelve al botón) o al tocar afuera. Sin descripción no se
 * muestra nada. El nombre de la skill lo da el grupo que lo contiene (el `fieldset` de la fila o un
 * `role="group"` con `aria-label`), así el botón no repite el nombre y no choca con otros botones
 * que se llaman como la skill. Es un `button type="button"`: nunca envía el formulario. La frase viene de
 * `skills.description` (texto fijo de la taxonomía, sin LLM) y se muestra como texto.
 *
 * Usa `display: contents`: el botón y el panel se acomodan en el contenedor que lo use (un flex
 * con `flex-wrap`, o una columna).
 */
export function SkillInfo({
  description,
  className = "",
}: {
  description: string | null | undefined;
  /** Clases del botón (p. ej. `self-start` dentro de una columna). */
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const root = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    }
    function onPointerDown(e: PointerEvent) {
      if (e.target instanceof Node && root.current?.contains(e.target)) return;
      setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  if (!description) return null;

  return (
    <span ref={root} className="contents">
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className={`min-h-11 rounded-md border border-zinc-300 px-3 py-1 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-zinc-900 ${className}`.trim()}
      >
        ¿Qué es?
      </button>
      <span
        id={panelId}
        hidden={!open}
        className="order-last w-full rounded-md bg-zinc-50 px-3 py-2 text-sm text-zinc-700"
      >
        {description}
      </span>
    </span>
  );
}
