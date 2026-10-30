"use client";

import { motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";

/**
 * Transición al abrir el detalle de una oferta (N3-5).
 * Client wrapper chico (Server Component por defecto).
 * Fade sutil con leve desplazamiento (6px) en 200 ms, sin layout shift.
 * Con `useReducedMotion()`, se muestra directo sin animación.
 */
export function DetailMotion({ children }: { children: ReactNode }) {
  const reduce = useReducedMotion();
  if (reduce) {
    return <article className="flex flex-col gap-4">{children}</article>;
  }
  return (
    <motion.article
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="flex flex-col gap-4"
    >
      {children}
    </motion.article>
  );
}
