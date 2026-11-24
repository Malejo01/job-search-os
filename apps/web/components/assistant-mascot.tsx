"use client";

import { domAnimation, LazyMotion, m, useReducedMotion } from "framer-motion";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { AssistantPanel } from "@/app/(app)/assistant-panel";
import { Mascota } from "@/components/mascota";
import { Icon } from "@/components/ui/icons";
import { claimAsistenteAviso } from "@/lib/asistente-aviso";
import { MASCOT_NAME } from "@/lib/textos-rediseno";
import { MASCOTA_DISPONIBLE } from "@/lib/mascota";

const FACE_READY = MASCOTA_DISPONIBLE["cara-48"];

/**
 * La cara del botón es `<Mascota pose="cara-48">` (imágenes en `public/mascota/`, ver
 * `lib/mascota.ts`). Mientras no existan queda el marcador de siempre (el «?») del mismo tamaño.
 */
const MASCOT_SIZE = 64;
const MASCOT_FACE_SIZE = 48;
/** El aviso se esconde solo a los 6 s, para no quedar encima del contenido. */
const HINT_MS = 6_000;

/** R26-05: el aviso se ve una sola vez por navegador (antes, una vez por sesión: volvía a tapar). */
function persistentStore(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** ¿El foco está en un campo donde se escribe? (fuera del propio panel del asistente) */
function isTypingField(el: Element | null): boolean {
  if (!(el instanceof HTMLElement) || el.closest("dialog")) return false;
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  if (el instanceof HTMLInputElement) {
    return !["button", "checkbox", "radio", "submit", "reset", "range", "file"].includes(el.type);
  }
  return el.isContentEditable;
}

/**
 * Mascota del asistente: botón fijo abajo a la derecha, por encima de las pestañas del celular
 * (`--tabbar-h`). En el celular es un círculo compacto de 44 px solo con el ícono de charla
 * (`aria-label`); desde `sm`, el círculo grande de siempre. Una vez por navegador, un aviso corto en
 * el celular dice para qué sirve y se cierra solo. Abre el panel del asistente. El panel vive acá, así la charla sigue al cambiar de
 * pantalla; al recargar se pierde, a propósito. El layout la monta solo si `canUseAssistant`.
 * Esc cierra el panel (`<dialog>` nativo) y el foco vuelve al botón. Con «reducir movimiento» no
 * hay animación. Framer Motion solo se usa acá, para la entrada y el hover.
 */
export function AssistantMascot({ maxTurns }: { maxTurns?: number }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const reduce = useReducedMotion();
  const [hint, setHint] = useState(false);
  // R26-05: en el celular el botón se esconde mientras se escribe en un campo (teclado abierto)
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    const onIn = () => setTyping(isTypingField(document.activeElement));
    const onOut = () => setTyping(false);
    document.addEventListener("focusin", onIn);
    document.addEventListener("focusout", onOut);
    return () => {
      document.removeEventListener("focusin", onIn);
      document.removeEventListener("focusout", onOut);
    };
  }, []);
  useEffect(() => {
    // Aparece un momento después de cargar la página y se va solo. Una sola vez por navegador; si
    // no hay almacenamiento, no se muestra. Se marca como visto recién al mostrarlo: si el efecto se
    // monta dos veces (modo estricto de React), la primera pasada no lo gasta.
    const show = window.setTimeout(() => {
      if (claimAsistenteAviso(persistentStore())) setHint(true);
    }, 800);
    const hide = window.setTimeout(() => setHint(false), 800 + HINT_MS);
    return () => {
      window.clearTimeout(show);
      window.clearTimeout(hide);
    };
  }, []);
  function closeHint() {
    setHint(false);
  }
  return (
    <>
      <LazyMotion features={domAnimation} strict>
        <m.div
          initial={reduce ? false : { opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          whileHover={reduce ? undefined : { scale: 1.06 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          data-escribiendo={typing ? "si" : "no"}
          className="fixed right-[calc(1rem+env(safe-area-inset-right,0px))] bottom-[calc(1rem+var(--tabbar-h,0px)+env(safe-area-inset-bottom,0px))] z-40 data-[escribiendo=si]:max-sm:hidden"
        >
          {hint ? (
            <div
              data-testid="asistente-aviso-inicial"
              className="pointer-events-none absolute right-0 bottom-full mb-2 w-48 rounded-card border-2 border-line-strong bg-surface p-2.5 pr-11 text-xs text-fg shadow-sm sm:hidden"
            >
              Preguntame lo que quieras sobre tu búsqueda.
              <button
                type="button"
                aria-label="Cerrar aviso del asistente"
                onClick={closeHint}
                className="pointer-events-auto absolute top-1 right-1 inline-flex min-h-11 min-w-11 items-center justify-center rounded-control text-fg-muted hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              >
                <Icon name="cruz" size={16} />
              </button>
            </div>
          ) : null}
          <button
            ref={buttonRef}
            type="button"
            aria-label="Abrir asistente"
            aria-haspopup="dialog"
            aria-expanded={open}
            data-testid="asistente-mascota"
            data-mascota-estado={FACE_READY ? "lista" : "marcador"}
            title={MASCOT_NAME}
            onClick={() => {
              closeHint();
              setOpen(true);
            }}
            style={{ "--mascota": `${MASCOT_SIZE}px` } as CSSProperties}
            className="inline-flex size-11 items-center justify-center overflow-hidden rounded-full border-2 border-line-strong bg-surface text-sm font-semibold text-fg shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus sm:h-[var(--mascota)] sm:w-[var(--mascota)] sm:bg-illustration sm:text-fg-muted"
          >
            <span className="sm:hidden" aria-hidden="true">
              <Icon name="charla" size={22} />
            </span>
            {FACE_READY ? (
              <Mascota pose="cara-48" size={MASCOT_FACE_SIZE} className="hidden sm:inline-flex" />
            ) : (
              <span className="hidden sm:inline-flex" aria-hidden="true">
                <Icon name="pregunta" size={28} />
              </span>
            )}
          </button>
        </m.div>
      </LazyMotion>
      <AssistantPanel
        open={open}
        {...(maxTurns !== undefined ? { maxTurns } : {})}
        onClose={() => {
          setOpen(false);
          buttonRef.current?.focus();
        }}
      />
    </>
  );
}
