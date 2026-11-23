"use client";

import { domAnimation, LazyMotion, m, useReducedMotion } from "framer-motion";
import { createContext, useContext, useState, type ReactNode } from "react";
import { barMotion, disclosureMotion } from "./motion-config";

const OpenCount = createContext(0);

/**
 * Detalle plegable con transición de altura (R23-06). Sigue siendo un `<details>` nativo (teclado,
 * sin JS no cambia nada): al abrirlo, el contenido crece desde altura 0. Cerrar es inmediato, como
 * el nativo. Cuenta las aperturas para que las barras de adentro (`GrowBar`) crezcan cada vez.
 * Con «reducir movimiento» no hay animación. El contenido llega ya armado desde el servidor.
 */
export function AnimatedDetails({
  summary,
  children,
  summaryClassName,
  ...rest
}: {
  summary: ReactNode;
  children: ReactNode;
  summaryClassName?: string;
  id?: string;
  className?: string;
  "data-testid"?: string;
}) {
  const reduce = useReducedMotion() ?? false;
  const [openCount, setOpenCount] = useState(0);
  const motion = disclosureMotion({ reduce, openCount });
  return (
    <LazyMotion features={domAnimation} strict>
      <details
        {...rest}
        onToggle={(e) => {
          if (e.currentTarget.open) setOpenCount((n) => n + 1);
        }}
      >
        <summary className={summaryClassName}>{summary}</summary>
        {/* key: cada apertura vuelve a montar el panel y arranca la transición */}
        <m.div
          key={openCount}
          initial={motion.initial}
          animate={motion.animate}
          transition={motion.transition}
          className="overflow-hidden"
        >
          <OpenCount.Provider value={openCount}>{children}</OpenCount.Provider>
        </m.div>
      </details>
    </LazyMotion>
  );
}

/** Relleno de una barra que crece al abrirse el detalle (escalonado por `index`). */
export function GrowBar({
  percent,
  index,
  className,
}: {
  percent: number;
  index: number;
  className?: string;
}) {
  const reduce = useReducedMotion() ?? false;
  const openCount = useContext(OpenCount);
  const motion = barMotion({ reduce, openCount, percent, index });
  return (
    <m.div
      initial={motion.initial}
      animate={motion.animate}
      transition={motion.transition}
      className={className}
    />
  );
}
