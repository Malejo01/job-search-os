"use client";

import { useLinkStatus } from "next/link";
import { useEffect } from "react";

/**
 * Indicador de carga de la navegación del cliente (R11-8). Va DENTRO de un `<Link>` de la barra
 * o de las pestañas (`useLinkStatus` solo funciona en un descendiente del link): mientras Next trae
 * la pantalla destino dibuja una línea fina bajo el link y marca `<main id="contenido">` con
 * `aria-busy`, para que el lector de pantalla sepa que la región se está actualizando.
 *
 * No hay `loading.tsx` ni `<Suspense>`: el servidor responde igual que siempre (status, 404,
 * redirects, página sin JavaScript). Sin JavaScript este componente no existe.
 *
 * - Sin saltos de diseño: la línea es `absolute` y no ocupa lugar.
 * - Con el link recién clickeado hay 150 ms de espera antes de mostrarla, para no parpadear en
 *   navegaciones rápidas (o ya precargadas).
 * - `prefers-reduced-motion`: sin transición ni pulso; la línea aparece fija.
 * - No toca el foco ni el nombre accesible del link (`aria-hidden`).
 */
export function NavPending({ className = "" }: { className?: string }) {
  const { pending } = useLinkStatus();

  useEffect(() => {
    if (!pending) return;
    const main = document.getElementById("contenido");
    main?.setAttribute("aria-busy", "true");
    return () => main?.removeAttribute("aria-busy");
  }, [pending]);

  return (
    <span
      aria-hidden="true"
      data-testid="nav-pending"
      data-pending={pending ? "true" : "false"}
      className={`pointer-events-none absolute h-0.5 rounded-pill bg-current opacity-0 transition-opacity delay-150 data-[pending=true]:animate-pulse data-[pending=true]:opacity-100 motion-reduce:animate-none motion-reduce:transition-none motion-reduce:delay-0 ${className}`}
    />
  );
}
