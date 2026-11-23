"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, buttonClasses } from "@/components/ui";
import { deleteInterviewAction } from "./actions";
import { DELETE_ERRORS } from "./copy";

/**
 * «Borrar» una simulación con confirmación en la misma tarjeta (sin `window.confirm`): el botón abre un aviso
 * con «Sí, borrar» y «Cancelar». El foco pasa a «Cancelar» (la opción segura) al abrir, vuelve a «Borrar» al
 * cancelar o con Escape, y va al título de la lista cuando la simulación ya no está.
 */
export function DeleteSessionButton({ sessionId, title }: { sessionId: string; title: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const openRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  function open() {
    setError(null);
    setConfirming(true);
    requestAnimationFrame(() => cancelRef.current?.focus());
  }

  function cancel() {
    if (pending) return;
    setConfirming(false);
    setError(null);
    requestAnimationFrame(() => openRef.current?.focus());
  }

  function confirmDelete() {
    if (pending) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteInterviewAction({ sessionId });
      if (!result.ok && result.error !== "not_found") {
        setError(DELETE_ERRORS[result.error] ?? DELETE_ERRORS.server!);
        return;
      }
      // Borrada (o ya no estaba): la tarjeta desaparece al refrescar; el foco va al título de la lista
      router.refresh();
      requestAnimationFrame(() => document.getElementById("interview-historial")?.focus());
    });
  }

  if (!confirming) {
    return (
      <button
        ref={openRef}
        type="button"
        onClick={open}
        aria-label={`Borrar la simulación ${title}`}
        className={buttonClasses({ variant: "ghost", size: "md" })}
        data-testid="interview-delete"
      >
        Borrar
      </button>
    );
  }

  return (
    <div
      role="group"
      aria-label={`Confirmar el borrado de ${title}`}
      className="flex flex-col gap-2 rounded-control border-2 border-line-strong p-3"
      data-testid="interview-delete-confirm"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          cancel();
        }
      }}
    >
      <p className="text-base font-bold text-fg">¿Borrar esta simulación?</p>
      <p className="text-sm text-fg-muted">
        Se borran también tus respuestas y las devoluciones. No se puede deshacer, y borrarla no te
        devuelve la simulación del día.
      </p>
      {error ? (
        <Alert tone="danger" role="alert" data-testid="interview-delete-error">
          {error}
        </Alert>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          variant="danger"
          size="md"
          onClick={confirmDelete}
          aria-disabled={pending}
          data-testid="interview-delete-yes"
        >
          {pending ? "Borrando…" : "Sí, borrar"}
        </Button>
        <button
          ref={cancelRef}
          type="button"
          onClick={cancel}
          aria-disabled={pending}
          className={buttonClasses({ variant: "secondary", size: "md" })}
          data-testid="interview-delete-cancel"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
