"use client";

import { motion, useReducedMotion } from "framer-motion";
import { useFormStatus } from "react-dom";

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
  const { pending } = useFormStatus();
  const reduce = useReducedMotion();
  return (
    <motion.button
      type="submit"
      aria-label={name}
      aria-pressed={pressed}
      disabled={pending}
      whileTap={reduce ? undefined : { scale: 0.95 }}
      className={`flex min-h-[44px] min-w-[88px] items-center justify-center gap-2 rounded-control border-2 px-4 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-50 ${
        pressed
          ? "border-brand bg-brand text-brand-contrast"
          : "border-fg-subtle bg-surface text-fg hover:border-fg-muted"
      }`}
    >
      <motion.span
        aria-hidden="true"
        animate={pressed && !reduce ? { scale: [1, 1.25, 1] } : undefined}
        transition={{ duration: 0.2 }}
      >
        {emoji}
      </motion.span>
      {label}
      {pressed ? (
        <motion.span
          aria-hidden="true"
          initial={reduce ? false : { scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.15 }}
        >
          ✓
        </motion.span>
      ) : null}
    </motion.button>
  );
}
