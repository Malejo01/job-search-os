"use client";

import { useRef, useState } from "react";
import { AssistantPanel } from "./assistant-panel";

/**
 * Botón «Asistente» del header (AG-3). El layout lo muestra solo si `canUseAssistant`. El panel
 * vive acá (en el layout de la app), así la charla sigue al cambiar de pantalla; al recargar se
 * pierde, a propósito: no se guarda en ningún lado.
 */
export function AssistantButton() {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="inline-flex min-h-11 items-center text-sm text-fg-muted underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        Asistente
      </button>
      <AssistantPanel
        open={open}
        onClose={() => {
          setOpen(false);
          buttonRef.current?.focus();
        }}
      />
    </>
  );
}
