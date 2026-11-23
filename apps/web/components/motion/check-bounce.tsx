"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";
import { firstTimeSeen, markSeen } from "./seen-once";

const KEY = "jso-pasos-hechos";

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** ¿Había registro de pasos al cargar la página? Se calcula una sola vez por carga. */
let hadRecord: boolean | null = null;
function hasRecord(): boolean {
  try {
    return window.localStorage.getItem(KEY) !== null;
  } catch {
    return false;
  }
}

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
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    if (!done) return;
    if (prefersReducedMotion()) {
      markSeen(KEY, id);
      return;
    }
    // Sin registro previo (primera vez en este navegador) no rebotan todos los pasos ya hechos: se
    // anotan en silencio y rebota solo el que se cumpla después (R-3). Se decide una vez por carga.
    if (hadRecord === null) hadRecord = hasRecord();
    if (!hadRecord) {
      markSeen(KEY, id);
      return;
    }
    if (!firstTimeSeen(KEY, id)) return;
    // R24-04: Web Animations API en vez de Framer, que entraba a /hoy solo por este rebote (~35 kB).
    ref.current?.animate?.(
      [
        { transform: "scale(0.3)" },
        { transform: "scale(1.18)", offset: 0.6 },
        { transform: "scale(1)" },
      ],
      { duration: 420, easing: "ease-out" },
    );
  }, [done, id]);
  return (
    <span ref={ref} className="inline-flex">
      {children}
    </span>
  );
}
