"use client";

import { useLinkStatus } from "next/link";
import { LISTADO_TEXTOS } from "@/lib/textos-rediseno";

/**
 * Estado de carga del listado (R30-05, corregido en R33-12). Va **dentro** de cada pestaña y chip: mientras el
 * link navega, anuncia «Cargando ofertas…» a los lectores de pantalla y suma «…» a la vista. No anima nada.
 *
 * Antes era el `fallback` de un `Suspense` que envolvía toda la lista. Con un `Suspense` que tarda, el HTML
 * del servidor lleva la lista en un bloque oculto que solo el JavaScript del navegador revela: sin
 * JavaScript, o con un servidor lento, la lista no se veía (e2e 89). El listado tiene que salir completo
 * del HTML del servidor, así que ya no hay límite de `Suspense` alrededor de la lista.
 */
export function LinkPending() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <>
      <span role="status" className="sr-only" data-testid="jobs-cargando">
        {LISTADO_TEXTOS.filtros.cargando}
      </span>
      <span aria-hidden="true">…</span>
    </>
  );
}
