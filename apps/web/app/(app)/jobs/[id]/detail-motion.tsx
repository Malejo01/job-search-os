"use client";

import { motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";

/**
 * Transición al abrir el detalle de una oferta (N3-5).
 * Client wrapper chico (Server Component por defecto).
 * Fade sutil con leve desplazamiento (6px) en 200 ms, sin layout shift.
 * Sin opacity:0 en SSR (initial={false}): el contenido nunca depende de JS para verse.
 * Con `useReducedMotion()`, se mantiene el mismo árbol con duración 0.
 */
export function DetailMotion({ children }: { children: ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <motion.article
      initial={false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduce ? 0 : 0.2 }}
      className="flex flex-col gap-4"
    >
      {children}
    </motion.article>
  );
}
