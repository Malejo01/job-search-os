"use client";

import { useEffect, useRef, useState } from "react";
import { AfiAnimadoLazy } from "@/components/afi-animado-lazy";
import { consumirFestejoPendiente } from "@/lib/festejo-pendiente";
import {
  FESTEJO_DURACION_MS,
  FESTEJO_TEXTOS,
  festejoCorresponde,
  type Festejo,
} from "@/lib/momentos";

/**
 * Festejo de un logro (R27-04): la mascota con el puño en alto y una frase, en un aviso en la esquina. No
 * bloquea nada (no es un diálogo: `role="status"`), se puede cerrar con el botón y se va solo.
 *
 * Una vez por evento, de dos maneras:
 * - `modo="cambio"`: el logro (`cumplido`) pasó de «no» a «sí» mientras la pantalla estaba abierta (la
 *   Server Action revalida y llega la prop nueva). Si ya estaba cumplido al entrar, o se recarga, no sale.
 * - `modo="pendiente"`: quien terminó el logro dejó una marca antes de navegar (`marcarFestejoPendiente`);
 *   se consume al montar.
 */
export function AfiFestejo({
  festejo,
  modo,
  cumplido = false,
}: {
  festejo: Festejo;
  modo: "cambio" | "pendiente";
  /** Solo en `modo="cambio"`: si el logro está cumplido ahora. */
  cumplido?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const previo = useRef<boolean | null>(null);

  useEffect(() => {
    let celebrar: boolean;
    if (modo === "pendiente") {
      celebrar = consumirFestejoPendiente(festejo);
    } else {
      celebrar = festejoCorresponde(previo.current, cumplido);
      previo.current = cumplido;
    }
    if (!celebrar) return;
    // En un callback (no en el cuerpo del efecto). Sin limpiar el timer: en desarrollo React corre el efecto
    // dos veces y la marca ya se consumió en la primera; mostrar después de desmontar no hace nada
    window.setTimeout(() => setVisible(true), 0);
  }, [festejo, modo, cumplido]);

  useEffect(() => {
    if (!visible) return;
    const timer = window.setTimeout(() => setVisible(false), FESTEJO_DURACION_MS);
    return () => window.clearTimeout(timer);
  }, [visible]);

  if (!visible) return null;
  const textos = FESTEJO_TEXTOS[festejo];
  return (
    <div
      role="status"
      data-testid="festejo"
      data-festejo={festejo}
      className="edge-6 fixed top-20 right-3 left-3 z-40 flex items-center gap-3 rounded-card border-edge bg-surface p-3 sm:left-auto sm:w-96"
    >
      <AfiAnimadoLazy pose="motivacion" size={64} variante="festejo" decorative />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-fg">{textos.titulo}</p>
        <p className="text-xs text-fg-muted">{textos.detalle}</p>
      </div>
      <button
        type="button"
        onClick={() => setVisible(false)}
        aria-label="Cerrar el aviso"
        data-testid="festejo-cerrar"
        className="inline-flex size-11 shrink-0 items-center justify-center rounded-control text-lg text-fg-muted hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
      >
        <span aria-hidden="true">×</span>
      </button>
    </div>
  );
}
