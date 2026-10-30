"use client";

import {
  FEEDBACK_CATEGORIES,
  FEEDBACK_CATEGORY_LABELS,
  FEEDBACK_MESSAGE_MAX,
} from "@job-search-os/pipeline";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { sendFeedbackAction } from "@/app/(app)/feedback-actions";
import { collectFeedbackContext } from "@/lib/action-tracker";
import { TextareaWithCounter, countChars } from "./char-counter";

const ERRORS: Record<string, string> = {
  category: "Elegí qué tipo de comentario es.",
  message: `Escribí tu mensaje (hasta ${FEEDBACK_MESSAGE_MAX} caracteres).`,
  limit: "Hoy ya enviaste varios comentarios. Probá de nuevo mañana.",
};
const GENERIC_ERROR = "No pudimos guardar tu mensaje. Probá de nuevo en un rato.";
const THANKS_MS = 5000;

/**
 * Chip fijo de soporte «¿Algo no anduvo?» (R1-9 / C-23). `<dialog>` nativo: `showModal()` atrapa el foco y Esc
 * cierra. Manda categoría, mensaje, la ruta actual (`usePathname()`: solo el pathname, sin query)
 * y el contexto de sesión (últimas acciones y metadatos de entorno).
 */
export function FeedbackButton() {
  const pathname = usePathname();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [thanks, setThanks] = useState(false);
  const [pending, startTransition] = useTransition();
  const [formKey, setFormKey] = useState(0);

  useEffect(() => {
    if (!thanks) return;
    const id = setTimeout(() => setThanks(false), THANKS_MS);
    return () => clearTimeout(id);
  }, [thanks]);

  function open() {
    setError(null);
    setFormKey((k) => k + 1); // formulario limpio cada vez que se abre
    dialogRef.current?.showModal();
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    if (!data.get("category")) return setError(ERRORS.category!);
    const length = countChars(String(data.get("message") ?? ""));
    if (length < 1 || length > FEEDBACK_MESSAGE_MAX) return setError(ERRORS.message!);

    // Adjunta contexto del entorno y buffer de acciones
    const context = collectFeedbackContext();
    data.set("context", JSON.stringify(context));

    setError(null);
    startTransition(async () => {
      const result = await sendFeedbackAction(data);
      if (result.ok) {
        dialogRef.current?.close();
        setThanks(true);
      } else {
        setError(ERRORS[result.field] ?? GENERIC_ERROR);
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={open}
        aria-haspopup="dialog"
        className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom,0px))] right-[calc(1rem+env(safe-area-inset-right,0px))] z-40 inline-flex min-h-11 items-center gap-1.5 rounded-pill border border-line-strong bg-surface px-3.5 py-1.5 text-xs font-medium text-fg-muted shadow-sm hover:bg-surface-muted hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        <span aria-hidden="true" className="text-sm">
          💬
        </span>
        ¿Algo no anduvo?
      </button>
      {thanks ? (
        <p
          role="status"
          className="fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] right-4 z-50 rounded-control bg-brand px-4 py-2 text-sm text-brand-contrast shadow-md"
        >
          ¡Gracias! Lo leemos todo.
        </p>
      ) : null}
      <dialog
        ref={dialogRef}
        aria-labelledby="feedback-title"
        className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-card bg-surface p-4 text-fg backdrop:bg-black/50"
      >
        <form key={formKey} onSubmit={onSubmit} className="flex flex-col gap-3">
          <h2 id="feedback-title" className="text-lg font-semibold">
            Contanos qué pasó
          </h2>
          <p className="text-sm text-fg-muted">
            Guardamos tu mensaje y la pantalla en la que estabas. No incluyas datos personales de
            otras personas ni datos sensibles tuyos.
          </p>
          <input type="hidden" name="path" value={pathname} />
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 text-sm font-medium">Tipo de comentario</legend>
            {FEEDBACK_CATEGORIES.map((c) => (
              <label key={c} className="flex min-h-11 items-center gap-2 text-sm">
                <input type="radio" name="category" value={c} className="h-4 w-4" />
                {FEEDBACK_CATEGORY_LABELS[c]}
              </label>
            ))}
          </fieldset>
          <div className="flex flex-col gap-1">
            <label htmlFor="message" className="text-sm font-medium">
              Tu mensaje
            </label>
            <TextareaWithCounter
              name="message"
              max={FEEDBACK_MESSAGE_MAX}
              rows={5}
              className="w-full rounded-control border border-line-control bg-surface p-2 text-base"
            />
          </div>
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              className="min-h-11 rounded-control border border-line-control px-4 py-2 text-base focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={pending}
              className="min-h-11 rounded-control bg-brand px-4 py-2 text-base font-medium text-brand-contrast hover:bg-brand-hover disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              {pending ? "Enviando…" : "Enviar"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
