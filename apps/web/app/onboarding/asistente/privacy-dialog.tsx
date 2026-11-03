"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { buttonClasses, textLinkClasses } from "@/components/ui";

/**
 * Modal de privacidad del asistente. `<dialog>` nativo: `showModal()` atrapa el foco y Esc cierra.
 * El contenido (el `TrustBox`, con su `h2#trust-box-title`) llega ya renderizado del servidor, así
 * el texto es el mismo que en el resto de la app. `acknowledge` fija la cookie y no vuelve a abrirse.
 */
export function PrivacyDialog({
  initiallyOpen,
  acknowledge,
  children,
}: {
  initiallyOpen: boolean;
  acknowledge: () => Promise<void>;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (initiallyOpen && dialog && !dialog.open) dialog.showModal();
  }, [initiallyOpen]);

  return (
    <>
      <button
        type="button"
        onClick={() => ref.current?.showModal()}
        className={textLinkClasses({ block: true, className: "self-start text-sm" })}
      >
        Qué leemos y qué no
      </button>
      <dialog
        ref={ref}
        aria-labelledby="trust-box-title"
        className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-card bg-surface p-5 text-fg backdrop:bg-black/50"
      >
        {children}
        <form action={acknowledge} className="mt-4 flex justify-end">
          <button type="submit" onClick={() => ref.current?.close()} className={buttonClasses()}>
            Entiendo y continúo
          </button>
        </form>
      </dialog>
    </>
  );
}
