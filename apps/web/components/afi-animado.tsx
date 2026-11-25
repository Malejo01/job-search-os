"use client";

import { AnimatePresence, domAnimation, LazyMotion, m, useReducedMotion } from "framer-motion";
import { Afi } from "@/components/afi";
import type { MascotaPose } from "@/lib/mascota";

/**
 * Afi animado (R27-02). Cliente: es el único lugar, junto con el botón del asistente, donde Afi usa
 * Framer Motion (`LazyMotion` + `domAnimation` + `m`, el paquete liviano). Las pantallas que no lo
 * necesitan usan `<Afi>` (servidor) o `<AfiAnimadoLazy>` (cargado aparte) y no suman Framer.
 *
 * Variantes:
 * - `entrada`: aparece con un rebote corto («saluda»).
 * - `flotar`: flota apenas en reposo (una vez por pantalla, nunca en listas).
 * - `festejo`: rebota y se sacude una vez.
 * - `hover`: se inclina y se agranda un poco al pasar el mouse.
 * - Al cambiar `pose` hay un fundido entre las dos imágenes (todas las variantes).
 *
 * `prefers-reduced-motion`: Afi quieto, sin transform ni transiciones (cambia de pose sin fundido).
 * Regla de la tanda: nunca más de un Afi animado por pantalla; esa regla la cumple quien lo monta.
 */
export type AfiVariante = "entrada" | "flotar" | "festejo" | "hover";

export type AfiAnimadoProps = {
  pose: MascotaPose;
  /** Lado del círculo y alto de la imagen, en px. */
  size?: number;
  variante?: AfiVariante;
  decorative?: boolean;
  priority?: boolean;
  className?: string;
};

const FUNDIDO_S = 0.25;

export function AfiAnimado({
  pose,
  size = 96,
  variante = "entrada",
  decorative = false,
  priority = false,
  className,
}: AfiAnimadoProps) {
  const reduce = useReducedMotion();
  const contenedor = "relative inline-block shrink-0 align-middle";

  if (reduce) {
    return (
      <span
        data-afi-animado={variante}
        data-movimiento="reducido"
        style={{ width: size, height: size }}
        className={contenedor}
      >
        <Afi
          pose={pose}
          size={size}
          decorative={decorative}
          priority={priority}
          {...(className ? { className } : {})}
        />
      </span>
    );
  }

  return (
    <LazyMotion features={domAnimation} strict>
      <m.span
        data-afi-animado={variante}
        data-movimiento="completo"
        style={{ width: size, height: size }}
        className={contenedor}
        {...(variante === "entrada"
          ? {
              initial: { opacity: 0, scale: 0.6, y: 12 },
              animate: { opacity: 1, scale: 1, y: 0 },
              transition: { type: "spring", stiffness: 380, damping: 14, mass: 0.8 },
            }
          : {})}
        {...(variante === "flotar"
          ? {
              animate: { y: [0, -4, 0] },
              transition: { duration: 3, ease: "easeInOut", repeat: Infinity },
            }
          : {})}
        {...(variante === "festejo"
          ? {
              animate: { y: [0, -16, 0, -8, 0], rotate: [0, -6, 6, -3, 0] },
              transition: { duration: 0.9, ease: "easeOut" },
            }
          : {})}
        {...(variante === "hover"
          ? {
              whileHover: { scale: 1.08, rotate: -3 },
              transition: { type: "spring", stiffness: 300, damping: 18 },
            }
          : {})}
      >
        {/* Fundido entre poses: la que sale y la que entra conviven un instante */}
        <AnimatePresence initial={false}>
          <m.span
            key={pose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: FUNDIDO_S }}
            className="absolute inset-0"
          >
            <Afi
              pose={pose}
              size={size}
              decorative={decorative}
              priority={priority}
              {...(className ? { className } : {})}
            />
          </m.span>
        </AnimatePresence>
      </m.span>
    </LazyMotion>
  );
}
