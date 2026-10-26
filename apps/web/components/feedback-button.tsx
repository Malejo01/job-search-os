"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { sendFeedbackAction } from "@/app/(app)/feedback-actions";
import {
  FEEDBACK_CATEGORIES,
  FEEDBACK_CATEGORY_LABELS,
  FEEDBACK_MESSAGE_MAX,
} from "@/lib/beta-feedback-core";
import { TextareaWithCounter, countChars } from "./char-counter";

const ERRORS: Record<string, string> = {
  category: "Elegí qué tipo de comentario es.",
  message: `Escribí tu mensaje (hasta ${FEEDBACK_MESSAGE_MAX} caracteres).`,
  limit: "Hoy ya enviaste varios comentarios. Probá de nuevo mañana.",
};
const GENERIC_ERROR = "No pudimos guardar tu mensaje. Probá de nuevo en un rato.";
const THANKS_MS = 5000;

/**
 * Botón «Contanos qué pasó» del header (C-23). `<dialog>` nativo: `showModal()` atrapa el foco y Esc
 * cierra. Manda categoría, mensaje y la ruta actual (`usePathname()`: solo el pathname, sin query).
 * El servidor valida igual; la respuesta nunca trae el texto.
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
        className="text-sm text-zinc-600 underline-offset-2 hover:underline"
      >
        Contanos qué pasó
      </button>
      {thanks ? (
        <p
          role="status"
          className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-md bg-zinc-900 px-4 py-2 text-sm text-white"
        >
          ¡Gracias! Lo leemos todo.
        </p>
      ) : null}
      <dialog
        ref={dialogRef}
        aria-labelledby="feedback-title"
        className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-md p-4 backdrop:bg-black/50"
      >
        <form key={formKey} onSubmit={onSubmit} className="flex flex-col gap-3">
          <h2 id="feedback-title" className="text-lg font-semibold">
            Contanos qué pasó
          </h2>
          <p className="text-sm text-zinc-700">
            Guardamos tu mensaje y la pantalla en la que estabas. No incluyas datos personales de
            otras personas.
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
              className="w-full rounded-md border border-zinc-400 p-2 text-base"
            />
          </div>
          {error ? (
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              className="min-h-11 rounded-md border border-zinc-400 px-4 py-2 text-base focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={pending}
              className="min-h-11 rounded-md bg-zinc-900 px-4 py-2 text-base font-medium text-white disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900"
            >
              {pending ? "Enviando…" : "Enviar"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
