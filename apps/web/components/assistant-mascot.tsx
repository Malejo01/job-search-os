"use client";

import { domAnimation, LazyMotion, m, useReducedMotion } from "framer-motion";
import { useRef, useState } from "react";
import { AssistantPanel } from "@/app/(app)/assistant-panel";
import { Icon } from "@/components/ui/icons";

/**
 * Imágenes de la mascota en `public/mascota/{quieta,hablando,pensando}.png` y `@2x` (las hace
 * Mauro). Mientras no existan queda el marcador neutro del mismo tamaño; al llegar las imágenes
 * se cambia esta bandera a `true`. No se dibuja ni se descarga ningún personaje.
 */
const MASCOT_IMAGES_AVAILABLE = false;
const MASCOT_SIZE = 64;
const MASCOT_BASE = "/mascota/quieta";

/**
 * Mascota del asistente: botón fijo abajo a la derecha, por encima de las pestañas del celular
 * (`--tabbar-h`). Abre el panel del asistente. El panel vive acá, así la charla sigue al cambiar de
 * pantalla; al recargar se pierde, a propósito. El layout la monta solo si `canUseAssistant`.
 * Esc cierra el panel (`<dialog>` nativo) y el foco vuelve al botón. Con «reducir movimiento» no
 * hay animación. Framer Motion solo se usa acá, para la entrada y el hover.
 */
export function AssistantMascot({ maxTurns }: { maxTurns?: number }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const reduce = useReducedMotion();
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
          <button
            ref={buttonRef}
            type="button"
            aria-label="Abrir asistente"
            aria-haspopup="dialog"
            aria-expanded={open}
            data-testid="asistente-mascota"
            data-mascota-estado={MASCOT_IMAGES_AVAILABLE ? "lista" : "marcador"}
            onClick={() => setOpen(true)}
            style={{ width: MASCOT_SIZE, height: MASCOT_SIZE }}
            className="flex items-center justify-center overflow-hidden rounded-full border-2 border-line-strong bg-illustration text-fg-muted shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            {MASCOT_IMAGES_AVAILABLE ? (
              // Imagen estática del mismo dominio: sin el optimizador de Next
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`${MASCOT_BASE}.png`}
                srcSet={`${MASCOT_BASE}.png 1x, ${MASCOT_BASE}@2x.png 2x`}
                width={MASCOT_SIZE}
                height={MASCOT_SIZE}
                alt=""
                decoding="async"
                className="h-full w-full object-contain"
              />
            ) : (
              <Icon name="pregunta" size={28} />
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
