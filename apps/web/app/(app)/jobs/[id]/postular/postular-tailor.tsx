"use client";

import { lazy, Suspense } from "react";

// R24-04b: todo el bloque (panel, botón de descarga y sus dependencias) va en un chunk aparte; solo lo
// baja quien tiene prendido el flag. Acá queda lo mínimo para que la ruta no lo cuente en su First Load.
const Cuerpo = lazy(() => import("./postular-tailor-cuerpo"));

/** Versión adaptada con IA dentro de «Preparar mi postulación» (R20-04b); la monta la página si el flag está prendido. */
export function PostularTailor({ jobId }: { jobId: string }) {
  return (
    <Suspense fallback={null}>
      <Cuerpo jobId={jobId} />
    </Suspense>
  );
}
