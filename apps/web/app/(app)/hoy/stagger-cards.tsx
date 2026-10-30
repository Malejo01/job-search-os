"use client";

import { motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";

/**
 * Aparición escalonada de tarjetas en /hoy (N3-5). Client wrapper chico;
 * la página se mantiene como Server Component.
 * Con «reducir movimiento» se muestra de inmediato sin desplazamientos.
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
  const shift = reduce ? 0 : 6;
  const colClass = wide ? "sm:col-span-2" : "";

  if (reduce) {
    return <div className={`min-w-0 ${colClass}`}>{children}</div>;
  }

  return (
    <motion.div
      initial={{ y: shift }}
      animate={{ y: 0 }}
      transition={{ duration: 0.2, delay: index * 0.04 }}
      className={`min-w-0 ${colClass}`}
    >
      {children}
    </motion.div>
  );
}
