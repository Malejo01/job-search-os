"use client";

import { filterChipClasses } from "@/components/ui/chip";

/**
 * Botón con microinteracción de 👍/👎 en el detalle (N3-5).
 * Pulsación táctil con whileTap, pulso breve del emoji y check animado al activarse.
 * Respeta `useReducedMotion()`.
 */
export function VerdictButton({
  name,
  label,
  emoji,
  pressed,
}: {
  name: string;
  label: string;
  emoji: string;
  pressed: boolean;
}) {
  return (
    <button
      type="submit"
      aria-label={name}
      aria-pressed={pressed}
      // C9-14: sin Framer; se hunde al tocar (CSS) y el elegido va como píldora activa
      className={filterChipClasses({ selected: pressed, className: "min-w-[88px]" })}
    >
      <span aria-hidden="true">{emoji}</span>
      {label}
      {pressed ? <span aria-hidden="true">✓</span> : null}
    </button>
  );
}
