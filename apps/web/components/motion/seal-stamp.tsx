"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";
import { firstTimeSeen, markSeen } from "./seen-once";

const KEY = "jso-sellos-vistos";

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

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
  const ref = useRef<HTMLSpanElement>(null);
  // Antes de pintar: si se va a estampar, arranca invisible (sin parpadeo del sello quieto)
  useLayoutEffect(() => {
    if (!evaluated) return;
    if (prefersReducedMotion()) {
      markSeen(KEY, jobId);
      return;
    }
    if (!firstTimeSeen(KEY, jobId)) return;
    // R24-04b: WAAPI en vez de Framer. Aproxima el resorte (rigidez 520, amortiguación 16): entra
    // grande y girado, se pasa un poco de largo y se asienta.
    ref.current?.setAttribute("data-estampado", "");
    ref.current?.animate?.(
      [
        { transform: "scale(1.9) rotate(-28deg)", opacity: 0 },
        { transform: "scale(0.88) rotate(5deg)", opacity: 1, offset: 0.35 },
        { transform: "scale(1.06) rotate(-2deg)", offset: 0.6 },
        { transform: "scale(0.98) rotate(0.5deg)", offset: 0.8 },
        { transform: "scale(1) rotate(0deg)", opacity: 1 },
      ],
      { duration: 560, easing: "ease-out", fill: "backwards" },
    );
  }, [evaluated, jobId]);
  return (
    <span ref={ref} data-sello-estampa="" className="inline-flex shrink-0">
      {children}
    </span>
  );
}
