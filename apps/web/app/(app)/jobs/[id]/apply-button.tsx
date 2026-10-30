"use client";

import { useEffect, useState } from "react";
import { changeStatusAction } from "./actions";

/**
 * P0.1: botón que lleva a la publicación original y, al volver a la app, pregunta si hubo
 * postulación.
 *
 * Es una **confirmación manual en el momento justo**, no detección: la app no ve el sitio
 * externo y no tiene forma de saber si la postulación se envió. Lo único que se automatiza es
 * el momento de preguntar (cuando la pestaña de la app vuelve a estar visible después de haber
 * abierto la oferta). Si la respuesta es "sí", dispara el mismo evento `apply` que el botón
 * "Marcar aplicada": transition() + fila en applications.
 */
export function ApplyButton({
  jobId,
  url,
  canApply,
}: {
  jobId: string;
  url: string;
  canApply: boolean;
}) {
  const [esperandoVuelta, setEsperandoVuelta] = useState(false);
  const [preguntando, setPreguntando] = useState(false);

  useEffect(() => {
    if (!esperandoVuelta) return;
    const volvio = () => {
      if (document.visibilityState !== "visible") return;
      setEsperandoVuelta(false);
      setPreguntando(true);
    };
    window.addEventListener("focus", volvio);
    document.addEventListener("visibilitychange", volvio);
    return () => {
      window.removeEventListener("focus", volvio);
      document.removeEventListener("visibilitychange", volvio);
    };
  }, [esperandoVuelta]);

  return (
    <>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => canApply && setEsperandoVuelta(true)}
        className="rounded-control border border-success-strong bg-success-strong px-4 py-2 text-sm font-medium text-on-strong hover:brightness-110"
      >
        {canApply ? "Postular ↗" : "Ver oferta ↗"}
      </a>
      {preguntando ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="¿Te postulaste a esta oferta?"
            className="w-full max-w-sm rounded-card border border-line bg-surface p-4 shadow-lg"
          >
            <p className="text-sm font-medium text-fg">¿Te postulaste a esta oferta?</p>
            <p className="mt-1 text-xs text-fg-subtle">
              Lo marcamos por lo que digas: la app no puede verlo en el sitio de la empresa.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPreguntando(false)}
                className="rounded-control border border-line-strong px-3 py-2 text-sm text-fg-muted"
              >
                No
              </button>
              <form action={changeStatusAction} onSubmit={() => setPreguntando(false)}>
                <input type="hidden" name="jobId" value={jobId} />
                <input type="hidden" name="event" value="apply" />
                <button
                  type="submit"
                  className="rounded-control border border-success-strong bg-success-strong px-3 py-2 text-sm font-medium text-on-strong"
                >
                  Sí
                </button>
              </form>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
