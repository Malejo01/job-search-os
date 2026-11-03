"use client";

import { domAnimation, LazyMotion, m, useAnimationControls, useReducedMotion } from "framer-motion";
import { useLayoutEffect, type ReactNode } from "react";
import { firstTimeSeen, markSeen } from "./seen-once";

const KEY = "jso-pasos-hechos";

/**
 * Momento de marca (b), C9-14 / decisión 13: el check se tilda con un rebote chico la primera vez
 * que se ve hecho un paso de un checklist («Para hacer hoy»). El registro va en `localStorage`; si
 * falla, no anima. Con «reducir movimiento» no se anima. Envuelve al ícono, que llega hecho.
 */
export function CheckBounce({
  id,
  done,
  children,
}: {
  /** Clave del paso, única para la persona (p. ej. `<userId>:perfil`). */
  id: string;
  done: boolean;
  children: ReactNode;
}) {
  const reduce = useReducedMotion();
  const controls = useAnimationControls();
  useLayoutEffect(() => {
    if (!done) return;
    if (reduce) {
      markSeen(KEY, id);
      return;
    }
    if (!firstTimeSeen(KEY, id)) return;
    controls.set({ scale: 0.3 });
    void controls.start({
      scale: [0.3, 1.18, 1],
      transition: { duration: 0.42, times: [0, 0.6, 1], ease: "easeOut" },
    });
  }, [controls, done, id, reduce]);
  // R-1: `m` + `domAnimation` en vez de `motion` entero: menos JS en /jobs y /hoy
  return (
    <LazyMotion features={domAnimation} strict>
      <m.span initial={false} animate={controls} className="inline-flex">
        {children}
      </m.span>
    </LazyMotion>
  );
}
