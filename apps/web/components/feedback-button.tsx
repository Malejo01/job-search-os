"use client";

import { buttonClasses } from "@/components/ui/button";

import { Icon } from "@/components/ui/icons";

import {
  FEEDBACK_CATEGORIES,
  FEEDBACK_CATEGORY_LABELS,
  FEEDBACK_MESSAGE_MAX,
  FEEDBACK_SUGGESTION_MAX,
} from "@job-search-os/pipeline";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { feedbackVoiceAction, sendFeedbackAction } from "@/app/(app)/feedback-actions";
import { joinDictated } from "@/components/dictar-engine";
import { VoiceInput } from "@/components/voice-input-lazy";
import { collectFeedbackContext } from "@/lib/action-tracker";
import {
  FEEDBACK_OPEN_EVENT,
  parseFeedbackOpenDetail,
  type FeedbackOpenDetail,
} from "@/lib/feedback-screen";
import { FEEDBACK_SUGGESTION_TEXTOS } from "@/lib/textos-recorrido";
import { TextareaWithCounter, countChars } from "./char-counter";

const ERRORS: Record<string, string> = {
  category: "Elegí qué tipo de comentario es.",
  message: `Escribí tu mensaje (hasta ${FEEDBACK_MESSAGE_MAX} caracteres).`,
  suggestion: FEEDBACK_SUGGESTION_TEXTOS.errorSuggestion,
  limit: "Hoy ya enviaste varios comentarios. Probá de nuevo mañana.",
};
const GENERIC_ERROR = "No pudimos guardar tu mensaje. Probá de nuevo en un rato.";
const THANKS_MS = 5000;

/**
 * Chip fijo de soporte «¿Algo no anduvo?» (R1-9 / C-23), abajo a la izquierda (R4-15). `<dialog>` nativo: `showModal()` atrapa el foco y Esc
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
  // R26-04: pantalla elegida de antemano («Comentar esta pantalla»); null = la pantalla actual
  const [target, setTarget] = useState<FeedbackOpenDetail | null>(null);
  // Voz en el mensaje: se pregunta al abrir si puede transcribir en el servidor (null = todavía no se sabe)
  const [serverTranscribe, setServerTranscribe] = useState<boolean | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!thanks) return;
    const id = setTimeout(() => setThanks(false), THANKS_MS);
    return () => clearTimeout(id);
  }, [thanks]);

  function openDialog(next: FeedbackOpenDetail | null) {
    setError(null);
    setTarget(next);
    setFormKey((k) => k + 1); // formulario limpio cada vez que se abre
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    if (serverTranscribe === null) {
      void feedbackVoiceAction()
        .then(setServerTranscribe)
        .catch(() => setServerTranscribe(false));
    }
  }

  // Suma lo dictado al final del mensaje, sin pasarse del tope. El campo no es controlado: se escribe el valor
  // con el setter nativo y se avisa con un evento `input`, así el contador de caracteres se entera.
  function appendDictated(spoken: string) {
    const field = formRef.current?.elements.namedItem("message");
    if (!(field instanceof HTMLTextAreaElement)) return;
    const next = Array.from(joinDictated(field.value, spoken))
      .slice(0, FEEDBACK_MESSAGE_MAX)
      .join("");
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(field, next);
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.focus();
  }

  function open() {
    openDialog(null);
  }

  // El evento lo dispara `openFeedbackForScreen` (p. ej. el botón de /recorrido)
  useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = parseFeedbackOpenDetail(event);
      if (detail) openDialog(detail);
    };
    window.addEventListener(FEEDBACK_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(FEEDBACK_OPEN_EVENT, onOpen);
  }, []);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    if (!data.get("category")) return setError(ERRORS.category!);
    const length = countChars(String(data.get("message") ?? ""));
    if (length < 1 || length > FEEDBACK_MESSAGE_MAX) return setError(ERRORS.message!);
    if (countChars(String(data.get("suggestion") ?? "")) > FEEDBACK_SUGGESTION_MAX) {
      return setError(ERRORS.suggestion!);
    }

    // Adjunta contexto del entorno y buffer de acciones
    const context = collectFeedbackContext();
    if (target) {
      // La pantalla elegida manda sobre la que se estaba mirando
      context.pathname = target.screen;
      context.pageTitle = target.label;
    }
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
        // C7-5: en el celular es un círculo de 44 px (el texto queda para lectores de pantalla) para no
        // tapar botones; las pantallas dejan 6rem libres abajo. Desde sm, la píldora con el texto.
        // `--tabbar-h` (R-3) lo sube por encima de la barra de pestañas del celular cuando está prendida.
        // R4-15: abajo a la IZQUIERDA en todos los anchos; la derecha es de la mascota del asistente.
        // R11-13: en el celular ya no flota (tapaba contenido): va en el flujo de la página, al final,
        // justo antes del pie (ver más abajo). El flotante queda desde `sm`.
        className="fixed bottom-[calc(1rem+var(--tabbar-h,0px)+env(safe-area-inset-bottom,0px))] left-[calc(1rem+env(safe-area-inset-left,0px))] z-40 hidden min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-pill border-2 border-line-strong bg-surface text-xs font-semibold text-fg-muted hover:bg-surface-muted hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus sm:inline-flex sm:px-3.5 sm:py-1.5"
      >
        {/* C9-17: ícono de la marca en vez del emoji */}
        <Icon name="charla" size={18} />
        <span>¿Algo no anduvo?</span>
      </button>
      <div className="flex justify-center px-4 pb-4 sm:hidden" data-testid="feedback-inline">
        <button
          type="button"
          onClick={open}
          aria-haspopup="dialog"
          className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-pill border-2 border-line-strong bg-surface px-3.5 text-xs font-semibold text-fg-muted hover:bg-surface-muted hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <Icon name="charla" size={18} />
          <span>¿Algo no anduvo?</span>
        </button>
      </div>
      {thanks ? (
        <p
          role="status"
          className="fixed bottom-[calc(4.5rem+var(--tabbar-h,0px)+env(safe-area-inset-bottom,0px))] left-4 z-50 rounded-control bg-ink px-4 py-2 text-sm text-on-ink"
        >
          ¡Gracias! Lo leemos todo.
        </p>
      ) : null}
      <dialog
        ref={dialogRef}
        aria-labelledby="feedback-title"
        className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-card bg-surface p-4 text-fg backdrop:bg-black/50"
      >
        <form key={formKey} ref={formRef} onSubmit={onSubmit} className="flex flex-col gap-3">
          <h2 id="feedback-title" className="text-lg font-semibold">
            Contanos qué pasó
          </h2>
          <p className="text-sm text-fg-muted">
            Guardamos tu mensaje y la pantalla en la que estabas. No incluyas datos personales de
            otras personas ni datos sensibles tuyos.
          </p>
          <input type="hidden" name="path" value={target?.screen ?? pathname} />
          {target ? (
            <p data-testid="feedback-pantalla" className="text-sm font-semibold text-fg">
              {FEEDBACK_SUGGESTION_TEXTOS.screenNote(target.label)}
            </p>
          ) : null}
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
            {/* Pedido de Ani (24/11): contar el problema hablando. Lo dictado cae en el mensaje para revisarlo
                antes de enviar; nunca se manda solo. */}
            {/* Se monta al abrir el modal por primera vez: el código de la voz no baja en cada pantalla */}
            {serverTranscribe !== null ? (
              <VoiceInput
                serverTranscribe={serverTranscribe}
                onText={appendDictated}
                disabled={pending}
                label="Dictar el mensaje"
              />
            ) : null}
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="feedback-suggestion" className="text-sm font-medium">
              {FEEDBACK_SUGGESTION_TEXTOS.label}{" "}
              <span className="font-normal text-fg-subtle">
                {FEEDBACK_SUGGESTION_TEXTOS.optional}
              </span>
            </label>
            <TextareaWithCounter
              name="suggestion"
              id="feedback-suggestion"
              max={FEEDBACK_SUGGESTION_MAX}
              rows={2}
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
            <button type="submit" disabled={pending} className={buttonClasses()}>
              {pending ? "Enviando…" : "Enviar"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
