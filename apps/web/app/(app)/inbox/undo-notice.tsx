"use client";

import { useEffect } from "react";

/** Cuánto dura el aviso de «Deshacer» después de una acción en lote. */
export const UNDO_MS = 10_000;

/**
 * Aviso de «Deshacer» (ronda 19). Siempre hay un `role="status"` en la página, así el lector de
 * pantalla anuncia el texto cuando aparece. Desaparece solo a los 10 s. El botón es un <button>
 * común: se alcanza y se acciona con el teclado.
 */
export function UndoNotice({
  notice,
  pending,
  onUndo,
  onExpire,
}: {
  notice: { key: number; message: string } | null;
  pending: boolean;
  onUndo: () => void;
  onExpire: () => void;
}) {
  const key = notice?.key;
  useEffect(() => {
    if (key === undefined) return;
    const timer = setTimeout(onExpire, UNDO_MS);
    return () => clearTimeout(timer);
  }, [key, onExpire]);

  return (
    <div role="status" aria-live="polite">
      {notice ? (
        <p className="flex flex-wrap items-center gap-3 rounded-control bg-brand px-3 py-2 text-xs text-brand-contrast">
          <span>{notice.message}</span>
          <button
            type="button"
            disabled={pending}
            onClick={onUndo}
            className="rounded-control border border-surface/60 px-2 py-1 font-medium"
          >
            Deshacer
          </button>
        </p>
      ) : null}
    </div>
  );
}
