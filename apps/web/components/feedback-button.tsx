"use client";

import { buttonClasses } from "@/components/ui/button";

import { Icon } from "@/components/ui/icons";

import {
  FEEDBACK_CATEGORIES,
  FEEDBACK_CATEGORY_LABELS,
  FEEDBACK_MESSAGE_MAX,
  FEEDBACK_SUGGESTION_MAX,
  REPORT_ITEMS_MAX,
  composeFeedbackMessage,
} from "@job-search-os/pipeline";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import {
  feedbackReportAccessAction,
  feedbackVoiceAction,
  sendFeedbackAction,
} from "@/app/(app)/feedback-actions";
import { addItemAction } from "@/app/(app)/recorrido/informe/informe-actions";
import { joinDictated } from "@/components/dictar-engine";
import { VoiceInput } from "@/components/voice-input-lazy";
import { collectFeedbackContext } from "@/lib/action-tracker";
import {
  FEEDBACK_OPEN_EVENT,
  parseFeedbackOpenDetail,
  type FeedbackOpenDetail,
} from "@/lib/feedback-screen";
import {
  clearFeedbackDraft,
  readFeedbackDraft,
  writeFeedbackDraft,
  type DraftStorage,
  type FeedbackDraft,
} from "@/lib/beta-feedback-draft";
import { INFORME_TEXTOS, llenarTexto } from "@/lib/textos-rediseno";
import { FEEDBACK_SUGGESTION_TEXTOS } from "@/lib/textos-recorrido";
import { TextareaWithCounter, countChars } from "./char-counter";

// R29-01: cada error dice qué pasó y que el texto sigue ahí (el borrador se conserva hasta el «¡Gracias!»).
const ERRORS: Record<string, string> = {
  category: "Elegí qué tipo de comentario es.",
  message: `Escribí tu mensaje (hasta ${FEEDBACK_MESSAGE_MAX} caracteres).`,
  suggestion: FEEDBACK_SUGGESTION_TEXTOS.errorSuggestion,
  limit:
    "Hoy ya enviaste varios comentarios. Probá de nuevo mañana: tu mensaje queda guardado acá.",
  session:
    "Se venció tu sesión y no se envió nada. Tu mensaje sigue acá: iniciá sesión en otra pestaña y volvé a tocar «Enviar».",
};
const GENERIC_ERROR =
  "No pudimos guardar tu mensaje. Tu mensaje sigue acá: probá de nuevo en un rato.";
const NETWORK_ERROR =
  "No pudimos conectarnos y no se envió nada. Tu mensaje sigue acá: revisá tu conexión y probá de nuevo.";
const THANKS_MS = 5000;

/** `sessionStorage` o `null` si el navegador lo bloquea (modo privado estricto, políticas): sin borrador, sin romper. */
function draftStorage(): DraftStorage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** `true` solo si el servidor contesta y dice que no hay sesión; cualquier otra cosa (sin red, error) es `false`. */
async function sessionIsGone(): Promise<boolean> {
  try {
    const res = await fetch("/api/auth/session", { cache: "no-store" });
    if (!res.ok) return false;
    const body: unknown = await res.json();
    const user = body && typeof body === "object" ? (body as { user?: unknown }).user : undefined;
    return !user;
  } catch {
    return false;
  }
}

/** Aviso cuando lo escrito, dictado o pegado pasa del tope (el contador solo lo marca en rojo). */
function overLimitNotice(over: number): string {
  return `Tu mensaje se pasa ${over} ${over === 1 ? "caracter" : "caracteres"} del máximo de ${FEEDBACK_MESSAGE_MAX}: acortalo para poder enviarlo. No se cortó nada.`;
}

/**
 * Chip fijo de soporte «¿Algo no anduvo?» (R1-9 / C-23), abajo a la izquierda (R4-15). `<dialog>` nativo: `showModal()` atrapa el foco y Esc
 * cierra. Manda categoría, mensaje, la ruta actual (`usePathname()`: solo el pathname, sin query)
 * y el contexto de sesión (últimas acciones y metadatos de entorno).
 */
export function FeedbackButton() {
  const pathname = usePathname();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [sessionLost, setSessionLost] = useState(false);
  // «sent» = el comentario se envió; «report» = se sumó al informe de revisión (R29-03)
  const [thanks, setThanks] = useState<null | "sent" | "report">(null);
  // R29-03: solo testers y admins ven «Agregar al informe» (se pregunta al servidor al abrir; null = todavía no se sabe)
  const [reportAccess, setReportAccess] = useState<boolean | null>(null);
  const [pending, startTransition] = useTransition();
  const [formKey, setFormKey] = useState(0);
  // R26-04: pantalla elegida de antemano («Comentar esta pantalla»); null = la pantalla actual
  const [target, setTarget] = useState<FeedbackOpenDetail | null>(null);
  // Voz en el mensaje: se pregunta al abrir si puede transcribir en el servidor (null = todavía no se sabe)
  const [serverTranscribe, setServerTranscribe] = useState<boolean | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  // R29-01: lo que quedó escrito y sin enviar (sessionStorage); es el valor inicial del formulario al abrirlo
  const [draft, setDraft] = useState<FeedbackDraft | null>(null);
  // R29-01: cuánto se pasa el mensaje del tope (0 = no se pasa); aviso visible para dictado y pegado
  const [overBy, setOverBy] = useState(0);

  useEffect(() => {
    if (!thanks) return;
    const id = setTimeout(() => setThanks(null), THANKS_MS);
    return () => clearTimeout(id);
  }, [thanks]);

  /** Guarda lo escrito en cada cambio (entrada, pegado, dictado y categoría) y actualiza el aviso del tope. */
  function onFormInput() {
    const form = formRef.current;
    if (!form) return;
    const data = new FormData(form);
    const message = String(data.get("message") ?? "");
    setOverBy(Math.max(0, countChars(message) - FEEDBACK_MESSAGE_MAX));
    const storage = draftStorage();
    if (!storage) return;
    writeFeedbackDraft(
      storage,
      {
        category: String(data.get("category") ?? ""),
        message,
        suggestion: String(data.get("suggestion") ?? ""),
      },
      Date.now(),
    );
  }

  function openDialog(next: FeedbackOpenDetail | null) {
    setError(null);
    setSessionLost(false);
    setTarget(next);
    const storage = draftStorage();
    const restored = storage ? readFeedbackDraft(storage, Date.now()) : null;
    setDraft(restored);
    setOverBy(restored ? Math.max(0, countChars(restored.message) - FEEDBACK_MESSAGE_MAX) : 0);
    setFormKey((k) => k + 1); // el formulario arranca con el borrador (o vacío si no hay) cada vez que se abre
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    if (serverTranscribe === null) {
      void feedbackVoiceAction()
        .then(setServerTranscribe)
        .catch(() => setServerTranscribe(false));
    }
    if (reportAccess === null) {
      void feedbackReportAccessAction()
        .then(setReportAccess)
        .catch(() => setReportAccess(false));
    }
  }

  // Suma lo dictado al final del mensaje. R29-01: ya no se corta en el tope (antes se perdía el final en silencio);
  // si se pasa, el contador y el aviso de abajo lo dicen y no deja enviar hasta acortarlo. El campo no es
  // controlado: se escribe el valor con el setter nativo y se avisa con un evento `input`, así el contador de
  // caracteres y el borrador se enteran.
  function appendDictated(spoken: string) {
    const field = formRef.current?.elements.namedItem("message");
    if (!(field instanceof HTMLTextAreaElement)) return;
    const next = joinDictated(field.value, spoken);
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
    setSessionLost(false);
    if (!data.get("category")) return setError(ERRORS.category!);
    const length = countChars(String(data.get("message") ?? ""));
    if (length < 1) return setError(ERRORS.message!);
    if (length > FEEDBACK_MESSAGE_MAX)
      return setError(overLimitNotice(length - FEEDBACK_MESSAGE_MAX));
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
      // R29-01: toda falla se ve en pantalla y el texto queda. Antes, un corte de red o un error del servidor
      // dejaba la transición con una excepción sin atrapar y el modal sin ningún mensaje.
      // Con la sesión vencida el middleware contesta la acción con una redirección y la página puede navegar o
      // recargarse perdiendo el modal: se mira la sesión ANTES de mandar y, si no hay, no se llama a la acción.
      if (await sessionIsGone()) {
        setSessionLost(true);
        setError(ERRORS.session!);
        return;
      }
      try {
        const result = await sendFeedbackAction(data);
        if (result.ok) {
          // El borrador se borra SOLO acá, con la confirmación del servidor
          const storage = draftStorage();
          if (storage) clearFeedbackDraft(storage);
          setDraft(null);
          setOverBy(0);
          dialogRef.current?.close();
          setThanks("sent");
        } else {
          setSessionLost(result.field === "session");
          setError(ERRORS[result.field] ?? GENERIC_ERROR);
        }
      } catch {
        // Con la sesión vencida el middleware contesta la server action con una redirección a /login: el navegador
        // recibe HTML y la acción falla sin decir por qué. Se distingue preguntando por la sesión (esa ruta no
        // pasa por el middleware de /login); si no se puede saber, se asume corte de conexión.
        const lost = await sessionIsGone();
        setSessionLost(lost);
        setError(lost ? ERRORS.session! : NETWORK_ERROR);
      }
    });
  }

  /** «Agregar al informe» (R29-03, solo testers y admins): suma este comentario como un ítem del borrador del informe. */
  function addToReport() {
    const form = formRef.current;
    if (!form) return;
    const data = new FormData(form);
    setSessionLost(false);
    const category = String(data.get("category") ?? "");
    if (!category) return setError(ERRORS.category!);
    const message = String(data.get("message") ?? "");
    const length = countChars(message);
    if (length < 1) return setError(ERRORS.message!);
    if (length > FEEDBACK_MESSAGE_MAX)
      return setError(overLimitNotice(length - FEEDBACK_MESSAGE_MAX));
    const suggestion = String(data.get("suggestion") ?? "");
    if (countChars(suggestion) > FEEDBACK_SUGGESTION_MAX) return setError(ERRORS.suggestion!);
    setError(null);
    const path = target?.screen ?? pathname;
    startTransition(async () => {
      if (await sessionIsGone()) {
        setSessionLost(true);
        setError(ERRORS.session!);
        return;
      }
      try {
        const out = await addItemAction({
          path,
          category,
          message: composeFeedbackMessage(message, suggestion),
        });
        if (out.ok) {
          const storage = draftStorage();
          if (storage) clearFeedbackDraft(storage);
          setDraft(null);
          setOverBy(0);
          dialogRef.current?.close();
          setThanks("report");
          return;
        }
        setSessionLost(out.reason === "session");
        setError(
          out.reason === "session"
            ? ERRORS.session!
            : out.reason === "too_many"
              ? llenarTexto(INFORME_TEXTOS.addToReportFull, { max: REPORT_ITEMS_MAX })
              : INFORME_TEXTOS.addToReportError,
        );
      } catch {
        const lost = await sessionIsGone();
        setSessionLost(lost);
        setError(lost ? ERRORS.session! : NETWORK_ERROR);
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
          data-testid={thanks === "report" ? "feedback-gracias-informe" : "feedback-gracias"}
          className="fixed bottom-[calc(4.5rem+var(--tabbar-h,0px)+env(safe-area-inset-bottom,0px))] left-4 z-50 rounded-control bg-ink px-4 py-2 text-sm text-on-ink"
        >
          {thanks === "report" ? (
            <>
              {INFORME_TEXTOS.addToReportDone}{" "}
              <Link href="/recorrido/informe" className="font-semibold underline">
                {INFORME_TEXTOS.addToReportLink}
              </Link>
            </>
          ) : (
            "¡Gracias! Lo leemos todo."
          )}
        </p>
      ) : null}
      <dialog
        ref={dialogRef}
        aria-labelledby="feedback-title"
        className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-card bg-surface p-4 text-fg backdrop:bg-black/50"
      >
        <form
          key={formKey}
          ref={formRef}
          onSubmit={onSubmit}
          onInput={onFormInput}
          className="flex flex-col gap-3"
        >
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
                <input
                  type="radio"
                  name="category"
                  value={c}
                  defaultChecked={draft?.category === c}
                  className="h-4 w-4"
                />
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
              defaultValue={draft?.message ?? ""}
              className="w-full rounded-control border border-line-control bg-surface p-2 text-base"
            />
            {overBy > 0 ? (
              <p
                role="status"
                data-testid="feedback-tope"
                className="text-sm font-medium text-danger"
              >
                {overLimitNotice(overBy)}
              </p>
            ) : null}
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
              defaultValue={draft?.suggestion ?? ""}
              className="w-full rounded-control border border-line-control bg-surface p-2 text-base"
            />
          </div>
          {error ? (
            <p role="alert" data-testid="feedback-error" className="text-sm text-danger">
              {error}
              {sessionLost ? (
                <>
                  {" "}
                  <a
                    href="/login"
                    target="_blank"
                    rel="noopener"
                    className="font-semibold underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                  >
                    Iniciar sesión (se abre en otra pestaña)
                  </a>
                </>
              ) : null}
            </p>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              className="min-h-11 rounded-control border border-line-control px-4 py-2 text-base focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              Cancelar
            </button>
            {/* R29-03: solo testers y admins (lo dice el servidor al abrir); el resto ve el modal de siempre */}
            {reportAccess ? (
              <button
                type="button"
                data-testid="feedback-agregar-informe"
                disabled={pending}
                onClick={addToReport}
                className={buttonClasses({ variant: "secondary" })}
              >
                {INFORME_TEXTOS.addToReport}
              </button>
            ) : null}
            <button type="submit" disabled={pending} className={buttonClasses()}>
              {pending ? "Enviando…" : "Enviar"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
