"use client";

import { lazy, Suspense } from "react";
import { Afi } from "@/components/afi";
import type { AfiAnimadoProps } from "@/components/afi-animado";

// `lazy` y no `next/dynamic` (como en el simulador de Interview): este último suma su propio cargador.
const AfiAnimado = lazy(() =>
  import("@/components/afi-animado").then((mod) => ({ default: mod.AfiAnimado })),
);

/**
 * `AfiAnimado` cargado aparte (R27-02): Framer Motion no entra al First Load de las pantallas que
 * lo usan; llega justo después de hidratar. Mientras tanto se ve `<Afi>` quieto, del mismo tamaño, así
 * que no salta el layout. Mismas props que `AfiAnimado`.
 */
export function AfiAnimadoLazy(props: AfiAnimadoProps) {
  const { pose, size, decorative, priority, className } = props;
  return (
    <Suspense
      fallback={
        <Afi
          pose={pose}
          {...(size !== undefined ? { size } : {})}
          {...(decorative !== undefined ? { decorative } : {})}
          {...(priority !== undefined ? { priority } : {})}
          {...(className ? { className } : {})}
        />
      }
    >
      <AfiAnimado {...props} />
    </Suspense>
  );
}
