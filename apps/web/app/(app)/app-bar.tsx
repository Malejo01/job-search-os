"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * Barra índigo de la app con sesión (C10-3): igual en claro y en oscuro. En Hoy es el comienzo de
 * la cabecera curva grande (18 px arriba y la página sigue en índigo debajo, sin costura); en el
 * resto es la barra fina (14 px). Client component solo para leer la ruta: el contenido (logo,
 * píldoras, avatar) llega armado del servidor. z-20: las tarjetas de /jobs llevan links z-10 y no
 * deben dibujarse encima; la guía (z-40) y los modales (z-50) quedan arriba.
 */
export function AppBar({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const cabecera = pathname === "/hoy";
  return (
    <header
      data-cabecera={cabecera ? "true" : undefined}
      className={
        cabecera
          ? "bg-ink pt-4 text-on-ink sm:pt-[18px]"
          : "sticky top-0 z-20 bg-ink pt-4 pb-3.5 text-on-ink sm:py-3.5"
      }
    >
      {children}
    </header>
  );
}
