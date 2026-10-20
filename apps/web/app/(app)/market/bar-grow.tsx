"use client";

import { motion, useReducedMotion } from "framer-motion";
import type { CSSProperties, ReactNode } from "react";

/**
 * Barra que crece de 0 a su ancho al aparecer (`scaleX`, desde la izquierda). Con "reducir
 * movimiento" no anima. El ancho llega en `style`; el texto de la fila ya dice el número.
 */
export function BarGrow({
  className,
  style,
  children,
}: {
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}) {
  const reduce = useReducedMotion();
  if (reduce) {
    return (
      <div className={className} style={style}>
        {children}
      </div>
    );
  }
  return (
    <motion.div
      className={className}
      style={{ ...style, originX: 0 }}
      initial={{ scaleX: 0 }}
      animate={{ scaleX: 1 }}
      transition={{ duration: 0.4 }}
    >
      {children}
    </motion.div>
  );
}
