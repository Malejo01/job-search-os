"use client";

import { domAnimation, LazyMotion, m, useReducedMotion } from "framer-motion";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { AssistantPanel } from "@/app/(app)/assistant-panel";
import { Mascota } from "@/components/mascota";
import { Icon } from "@/components/ui/icons";
import { MASCOT_NAME } from "@/lib/textos-rediseno";
import { MASCOTA_DISPONIBLE } from "@/lib/mascota";

const FACE_READY = MASCOTA_DISPONIBLE["cara-48"];

/**
 * La cara del botón es `<Mascota pose="cara-48">` (imágenes en `public/mascota/`, ver
 * `lib/mascota.ts`). Mientras no existan queda el marcador de siempre (el «?») del mismo tamaño.
 */
const MASCOT_SIZE = 64;
const MASCOT_FACE_SIZE = 48;
/** Clave del aviso de bienvenida: se muestra una sola vez por navegador. */
const HINT_KEY = "afinia:asistente-aviso-visto";
/** El aviso se esconde solo a los 10 s, para no quedar encima del contenido. */
const HINT_MS = 10_000;

function hintSeen(): boolean {
  try {
    return window.localStorage.getItem(HINT_KEY) === "1";
  } catch {
    return true;
  }
}

function markHintSeen() {
  try {
    window.localStorage.setItem(HINT_KEY, "1");
  } catch {
    // Sin almacenamiento (modo privado): el aviso vuelve a aparecer, no pasa nada
  }
}

/**
 * Mascota del asistente: botón fijo abajo a la derecha, por encima de las pestañas del celular
 * (`--tabbar-h`). En el celular es una píldora con «Asistente» (con el «?» solo no se reconocía);
 * desde `sm`, el círculo de siempre. La primera vez, un aviso corto en el celular dice para qué sirve. Abre el panel del asistente. El panel vive acá, así la charla sigue al cambiar de
 * pantalla; al recargar se pierde, a propósito. El layout la monta solo si `canUseAssistant`.
 * Esc cierra el panel (`<dialog>` nativo) y el foco vuelve al botón. Con «reducir movimiento» no
 * hay animación. Framer Motion solo se usa acá, para la entrada y el hover.
 */
export function AssistantMascot({ maxTurns }: { maxTurns?: number }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const reduce = useReducedMotion();
  const [hint, setHint] = useState(false);
  useEffect(() => {
    if (hintSeen()) return;
    // Aparece un momento después de cargar la página y se va solo
    const show = window.setTimeout(() => setHint(true), 800);
    const hide = window.setTimeout(() => setHint(false), 800 + HINT_MS);
    return () => {
      window.clearTimeout(show);
      window.clearTimeout(hide);
    };
  }, []);
  function closeHint() {
    setHint(false);
    markHintSeen();
  }
  return (
    <>
      <LazyMotion features={domAnimation} strict>
        <m.div
          initial={reduce ? false : { opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          whileHover={reduce ? undefined : { scale: 1.06 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className="fixed right-[calc(1rem+env(safe-area-inset-right,0px))] bottom-[calc(1rem+var(--tabbar-h,0px)+env(safe-area-inset-bottom,0px))] z-40"
        >
          {hint ? (
            <div
              data-testid="asistente-aviso-inicial"
              className="pointer-events-none absolute right-0 bottom-full mb-2 w-56 rounded-card border-2 border-line-strong bg-surface p-3 pr-9 text-sm text-fg shadow-sm sm:hidden"
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
            className="inline-flex min-h-11 items-center justify-center gap-1.5 overflow-hidden rounded-pill border-2 border-line-strong bg-surface px-3.5 text-sm font-semibold text-fg shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus sm:h-[var(--mascota)] sm:w-[var(--mascota)] sm:rounded-full sm:bg-illustration sm:px-0 sm:text-fg-muted"
          >
            <span className="sm:hidden" aria-hidden="true">
              <Icon name="charla" size={20} />
            </span>
            <span className="sm:hidden">Asistente</span>
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
