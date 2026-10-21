"use client";

import { useEffect } from "react";

/**
 * Marca la visita a «Hoy»: sin DOM. Una Server Component no puede escribir cookies, así que al
 * montar llama a la action que viene de la página. Sin JS no se marca y rige la ventana de 7 días.
 */
export function MarkVisit({ action }: { action: () => Promise<void> }) {
  useEffect(() => {
    void action().catch(() => undefined);
  }, [action]);
  return null;
}
