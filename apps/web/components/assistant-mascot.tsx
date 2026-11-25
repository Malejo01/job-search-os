"use client";

import { domAnimation, LazyMotion, m, useReducedMotion } from "framer-motion";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { AssistantPanel } from "@/app/(app)/assistant-panel";
import { AfiCara } from "@/components/afi";
import { Icon } from "@/components/ui/icons";
import { claimAsistenteAviso } from "@/lib/asistente-aviso";
import { MASCOTA_NOMBRE } from "@/lib/mascota";
import { MASCOT_NAME } from "@/lib/textos-rediseno";

/**
 * La cara del botón es `<AfiCara>` (`public/mascota/cara-*`, ver `lib/mascota.ts`) sobre el círculo
 * lavanda: 48 px en el botón de 64 desde `sm`, y 40 px en el de 44 del celular.
 */
const MASCOT_SIZE = 64;
const MASCOT_FACE_SIZE = 48;
const MASCOT_FACE_SIZE_MOBILE = 40;
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
          // Solo fundido al entrar: sin escala, el botón mide 44 px reales desde el primer cuadro
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          // Un solo Afi animado por pantalla: con el panel abierto (el de adentro se anima) el botón queda quieto
          whileHover={reduce || open ? undefined : { scale: 1.06 }}
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
            aria-label={`Preguntale a ${MASCOTA_NOMBRE}`}
            aria-haspopup="dialog"
            aria-expanded={open}
            data-testid="asistente-mascota"
            title={MASCOT_NAME}
            onClick={() => {
              closeHint();
              setOpen(true);
            }}
            style={{ "--mascota": `${MASCOT_SIZE}px` } as CSSProperties}
            className="inline-flex size-11 items-center justify-center overflow-hidden rounded-full border-2 border-line-strong bg-illustration text-sm font-semibold text-fg shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus sm:h-[var(--mascota)] sm:w-[var(--mascota)]"
          >
            {/* Celular: la cara entra justo en los 44 px del botón (borde de 2 px incluido) */}
            {/* Cada cara va en su propio span: el `hidden` no compite con el `inline-flex` de AfiCara */}
            <span className="inline-flex sm:hidden">
              <AfiCara size={MASCOT_FACE_SIZE_MOBILE} />
            </span>
            <span className="hidden sm:inline-flex">
              <AfiCara size={MASCOT_FACE_SIZE} />
            </span>
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
