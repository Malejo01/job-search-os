"use client";

import { useEffect, useRef, type ReactNode } from "react";

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
        className="self-start text-sm underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-zinc-900"
      >
        Qué leemos y qué no
      </button>
      <dialog
        ref={ref}
        aria-labelledby="trust-box-title"
        className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-md p-4 backdrop:bg-black/50"
      >
        {children}
        <form action={acknowledge} className="mt-3 flex justify-end">
          <button
            type="submit"
            onClick={() => ref.current?.close()}
            className="rounded-md bg-zinc-900 px-4 py-2 text-base font-medium text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900"
          >
            Entiendo y continúo
          </button>
        </form>
      </dialog>
    </>
  );
}
