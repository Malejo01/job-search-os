"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { barMotion, disclosureMotion } from "./motion-config";

const OpenCount = createContext(0);

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/**
 * Detalle plegable con transición de altura (R23-06). Sigue siendo un `<details>` nativo (teclado,
 * sin JS no cambia nada): al abrirlo, el contenido crece desde altura 0. Cerrar es inmediato, como
 * el nativo. Cuenta las aperturas para que las barras de adentro (`GrowBar`) crezcan cada vez.
 * Con «reducir movimiento» no hay animación. El contenido llega ya armado desde el servidor.
 * R24-04b: la transición usa la Web Animations API (sin Framer Motion en el cliente).
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
  const [openCount, setOpenCount] = useState(0);
  const panel = useRef<HTMLDivElement>(null);
  return (
    <details
      {...rest}
      onToggle={(e) => {
        if (!e.currentTarget.open) return;
        const next = openCount + 1;
        setOpenCount(next);
        const motion = disclosureMotion({ reduce: prefersReducedMotion(), openCount: next });
        if (motion.initial === false) return;
        panel.current?.animate?.(
          [
            { height: "0px", opacity: 0 },
            { height: `${panel.current.scrollHeight}px`, opacity: 1 },
          ],
          { duration: motion.transition.duration * 1000, easing: "ease-out" },
        );
      }}
    >
      <summary className={summaryClassName}>{summary}</summary>
      <div ref={panel} className="overflow-hidden">
        <OpenCount.Provider value={openCount}>{children}</OpenCount.Provider>
      </div>
    </details>
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
  const openCount = useContext(OpenCount);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const motion = barMotion({
      reduce: prefersReducedMotion(),
      openCount,
      percent,
      index,
    });
    if (motion.initial === false) return;
    ref.current?.animate?.([{ width: "0%" }, { width: `${percent}%` }], {
      duration: motion.transition.duration * 1000,
      delay: motion.transition.delay * 1000,
      easing: "ease-out",
      fill: "backwards",
    });
  }, [openCount, percent, index]);
  return <div ref={ref} style={{ width: `${percent}%` }} className={className} />;
}
