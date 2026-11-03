"use client";

import { motion, useAnimationControls, useReducedMotion } from "framer-motion";
import { useLayoutEffect, type ReactNode } from "react";
import { firstTimeSeen, markSeen } from "./seen-once";

const KEY = "jso-sellos-vistos";

/**
 * Momento de marca (a), C9-14 / decisión 13: el sello se estampa (entra grande y girado, rebota y
 * queda) la primera vez que la persona ve esa oferta evaluada. Eso incluye cuando la evaluación pasa
 * de pendiente a lista con la pantalla abierta: la página se recarga sola y el sello evaluado es
 * nuevo. El registro de «ya vista» va en `localStorage`; si falla, no anima.
 *
 * Solo en el sello grande (detalle y panel de /jobs): en las listas serían muchos a la vez.
 * Con «reducir movimiento» no se anima, pero queda marcada como vista. El sello en sí es un Server
 * Component que llega como `children`; acá solo se mueve la caja.
 */
export function SealStamp({
  jobId,
  evaluated,
  children,
}: {
  jobId: string;
  /** Sin evaluación (en cola, sin evaluar) no se estampa ni se marca. */
  evaluated: boolean;
  children: ReactNode;
}) {
  const reduce = useReducedMotion();
  const controls = useAnimationControls();
  // Antes de pintar: si se va a estampar, arranca invisible (sin parpadeo del sello quieto)
  useLayoutEffect(() => {
    if (!evaluated) return;
    if (reduce) {
      markSeen(KEY, jobId);
      return;
    }
    if (!firstTimeSeen(KEY, jobId)) return;
    controls.set({ scale: 1.9, rotate: -28, opacity: 0 });
    void controls.start({
      scale: 1,
      rotate: 0,
      opacity: 1,
      transition: { type: "spring", stiffness: 520, damping: 16, mass: 0.9 },
    });
  }, [controls, evaluated, jobId, reduce]);
  return (
    <motion.span
      initial={false}
      animate={controls}
      data-sello-estampa=""
      className="inline-flex shrink-0"
    >
      {children}
    </motion.span>
  );
}
