"use client";

import { motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";

/**
 * Aparición escalonada de tarjetas en /hoy (N3-5). Client wrapper chico;
 * la página se mantiene como Server Component.
 * Sin opacity:0 en SSR (initial={false}): el contenido nunca depende de JS para verse.
 * Con «reducir movimiento» se mantiene el mismo árbol con shift 0 y duración 0.
 * `min-w-0` evita desbordes en el grid a 360 px; `wide` respeta `sm:col-span-2`.
 */
export function StaggerCard({
  wide,
  index = 0,
  children,
}: {
  wide?: boolean;
  index?: number;
  children: ReactNode;
}) {
  const reduce = useReducedMotion();
  const colClass = wide ? "sm:col-span-2" : "";

  return (
    <motion.div
      initial={false}
      animate={{ y: 0 }}
      transition={{ duration: reduce ? 0 : 0.2, delay: reduce ? 0 : index * 0.04 }}
      className={`min-w-0 ${colClass}`}
    >
      {children}
    </motion.div>
  );
}
