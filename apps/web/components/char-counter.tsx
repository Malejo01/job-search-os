"use client";

import { useId, useRef, useState } from "react";

/** Aviso desde este porcentaje del máximo. */
const WARN_RATIO = 0.9;

type CounterState = "ok" | "warn" | "over";

/** Largo como lo cuenta el servidor: \r\n y \r son un solo salto, sin espacios en los bordes. */
export function countChars(value: string): number {
  return value.replace(/\r\n?/g, "\n").trim().length;
}

function stateOf(length: number, max: number): CounterState {
  return length > max ? "over" : length >= max * WARN_RATIO ? "warn" : "ok";
}

/**
 * Textarea con contador `n / max`. Sin `maxLength` a propósito: el navegador recortaría el pegado
 * en silencio. El largo es el de `value` (el salto de línea cuenta 1, como lo normaliza el
 * servidor). Pasado el máximo el contador se pone en rojo y el formulario no se envía: el form
 * busca los `textarea[data-max]` y compara con `data-max`. El servidor valida igual.
 *
 * El lector de pantalla no oye cada tecla: la región `aria-live` cambia solo al cruzar el 90 % y
 * al pasarse del máximo.
 */
export function TextareaWithCounter({
  name,
  min,
  max,
  rows,
  required,
  describedBy,
  invalid,
  defaultValue = "",
  className = "",
}: {
  name: string;
  min?: number;
  max: number;
  rows?: number;
  required?: boolean;
  /** Ids de otros elementos que describen el campo (ayuda, error). */
  describedBy?: string;
  invalid?: boolean;
  defaultValue?: string;
  className?: string;
}) {
  const [length, setLength] = useState(() => countChars(defaultValue));
  const [announcement, setAnnouncement] = useState("");
  const lastState = useRef<CounterState>(stateOf(length, max));
  const counterId = useId();
  const over = length - max;
  const state = stateOf(length, max);
  const color =
    state === "over" ? "text-red-700" : state === "warn" ? "text-amber-800" : "text-zinc-600";
  const hint =
    state === "over" ? `${over} de más` : state === "warn" ? `te quedan ${max - length}` : null;

  function onChange(value: string) {
    const n = countChars(value);
    setLength(n);
    const next = stateOf(n, max);
    if (next === lastState.current) return;
    lastState.current = next;
    // Solo al cruzar un umbral: el número es el de ese momento, no se repite en cada tecla
    setAnnouncement(
      next === "over"
        ? "Te pasaste del máximo de caracteres."
        : next === "warn"
          ? `Te quedan ${max - n} caracteres.`
          : "",
    );
  }
  return (
    <>
      <textarea
        id={name}
        name={name}
        rows={rows}
        required={required}
        minLength={min}
        data-max={max}
        defaultValue={defaultValue}
        aria-invalid={invalid || state === "over" ? true : undefined}
        aria-describedby={[describedBy, counterId].filter(Boolean).join(" ")}
        onChange={(e) => onChange(e.target.value)}
        className={className}
      />
      <p id={counterId} className={`text-xs ${color}`} data-testid={`${name}-counter`}>
        <span>
          {length} / {max}
        </span>
        {hint ? <span> · {hint}</span> : null}
      </p>
      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>
    </>
  );
}
