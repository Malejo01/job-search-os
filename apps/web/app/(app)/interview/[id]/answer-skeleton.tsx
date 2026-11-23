"use client";

import { domAnimation, LazyMotion, m, useReducedMotion } from "framer-motion";
import { INTERVIEW_TEXTOS } from "@/lib/textos-rediseno";

const BARS = ["w-11/12", "w-4/5", "w-3/5"] as const;

/**
 * Mientras se evalúa una respuesta (R23-08): tres barras que pulsan y «Analizando tu respuesta…». Con
 * movimiento reducido las barras quedan quietas; el texto va siempre. Reserva la altura de la devolución para
 * que no salte el diseño al llegar. Framer ya viaja con el dictado de esta pantalla: no suma bundle.
 */
export function AnswerSkeleton() {
  const reduce = useReducedMotion();
  return (
    <LazyMotion features={domAnimation} strict>
      <div
        role="status"
        aria-busy="true"
        data-testid="interview-skeleton"
        className="flex min-h-40 flex-col gap-3 rounded-control bg-surface-muted p-4"
      >
        <p className="text-sm font-bold text-fg">{INTERVIEW_TEXTOS.analizando}</p>
        {BARS.map((width) => (
          <m.span
            key={width}
            aria-hidden="true"
            className={`block h-4 rounded-pill bg-line ${width}`}
            animate={reduce ? undefined : { opacity: [1, 0.45, 1] }}
            transition={reduce ? undefined : { duration: 1.4, repeat: Infinity }}
          />
        ))}
      </div>
    </LazyMotion>
  );
}
