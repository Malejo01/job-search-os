"use client";

import { useEffect, useId, useRef, useSyncExternalStore } from "react";
import { buttonClasses } from "@/components/ui";
import { useVoiceInput } from "@/lib/voice/use-voice-input";
import {
  VOICE_BAR_COUNT,
  barScale,
  formatElapsed,
  levelDigit,
  voicePrivacyNote,
} from "@/lib/voice/voice-ui";

export type VoiceInputProps = {
  /** La persona puede transcribir en el servidor (viene de `voiceServerAllowedFor`, desde el Server Component). */
  serverTranscribe: boolean;
  /** Recibe el texto dictado al tocar «Listo». Nunca se envía solo: quien lo usa lo suma al campo con `joinDictated`. */
  onText: (text: string) => void;
  disabled?: boolean;
  /** Texto del botón. Por defecto «Dictar». */
  label?: string;
  className?: string;
};

const subscribeReduced = (cb: () => void) => {
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};
const reducedSnapshot = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const BARS = Array.from({ length: VOICE_BAR_COUNT }, (_, i) => i);

/**
 * Entrada por voz (R25-02), reemplaza a `Dictar`. Elige sola el camino (dictado del navegador con texto en vivo, o
 * grabación que se transcribe en el servidor al terminar) y muestra que está escuchando: punto rojo, contador y
 * barras de nivel. Las barras se mueven con `requestAnimationFrame` y estilos directos (sin Framer ni re-render por
 * cuadro); con movimiento reducido, un número de nivel.
 */
export function VoiceInput({
  serverTranscribe,
  onText,
  disabled,
  label = "Dictar",
  className,
}: VoiceInputProps) {
  const noteId = useId();
  const voice = useVoiceInput({ serverTranscribe, onText });
  const { state } = voice;
  const reduced = useSyncExternalStore(subscribeReduced, reducedSnapshot, () => false);

  const active = state.status === "pidiendo-permiso" || state.status === "escuchando";
  const listening = state.status === "escuchando";

  const voiceRef = useRef(voice);
  useEffect(() => {
    voiceRef.current = voice;
  });
  const barRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const levelBox = useRef<HTMLDivElement | null>(null);
  const levelNumber = useRef<HTMLSpanElement | null>(null);

  // Barras: se leen los niveles cuadro a cuadro y se escriben directo en el DOM
  useEffect(() => {
    if (!listening) return;
    let raf = 0;
    let lastDigit = -1;
    const frame = () => {
      const v = voiceRef.current;
      const level = v.getLevel();
      if (levelBox.current) levelBox.current.dataset.level = level.toFixed(2);
      if (reduced) {
        const digit = levelDigit(level);
        if (digit !== lastDigit && levelNumber.current) {
          lastDigit = digit;
          levelNumber.current.textContent = String(digit);
        }
      } else {
        const levels = v.getLevels(VOICE_BAR_COUNT);
        barRefs.current.forEach((el, i) => {
          if (el) el.style.transform = `scaleY(${barScale(levels[i] ?? 0).toFixed(3)})`;
        });
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [listening, reduced]);

  // Si el campo se deshabilita (por ejemplo, mientras se envía) se corta sin entregar nada
  useEffect(() => {
    if (disabled && (active || state.status === "transcribiendo")) voiceRef.current.cancel();
  }, [disabled, active, state.status]);

  if (voice.unsupportedForRecording) {
    return (
      <div className={className ?? "flex flex-col gap-1"} data-testid="voice-input">
        <p className="text-xs text-fg-subtle" data-testid="voice-no-disponible">
          {voice.unavailableMessage}
        </p>
      </div>
    );
  }

  const note = voicePrivacyNote(state.mode ?? voice.plannedPath, serverTranscribe);
  const transcribing = state.status === "transcribiendo";

  let statusText: string | null = null;
  if (state.status === "pidiendo-permiso") statusText = "Esperando el permiso del micrófono…";
  else if (state.status === "escuchando") {
    // Se anuncia una vez; el aviso de 1:45 reemplaza al texto (el contador no se anuncia)
    statusText = state.warning
      ? "Queda poco: la grabación se corta a los 2:00. Tocá Listo para terminar."
      : "Escuchando. Hablá y tocá Listo cuando termines.";
  } else if (state.status === "transcribiendo") {
    statusText = "Transcribiendo…";
  } else if (state.status === "listo") {
    statusText = state.text
      ? "Listo: el texto está en el campo para que lo corrijas."
      : "No escuchamos nada. Probá de nuevo.";
  }

  return (
    <div className={className ?? "flex flex-col gap-2"} data-testid="voice-input">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={voice.start}
          disabled={disabled || active || transcribing}
          aria-pressed={active}
          aria-describedby={noteId}
          className={buttonClasses({ variant: "secondary", size: "sm" })}
          data-testid="voice-boton"
        >
          {active ? "Dictando…" : label}
        </button>
        {listening ? (
          <>
            <button
              type="button"
              onClick={voice.stop}
              className={buttonClasses({ variant: "primary", size: "sm" })}
              data-testid="voice-listo"
            >
              Listo
            </button>
            <button
              type="button"
              onClick={voice.cancel}
              className={buttonClasses({ variant: "secondary", size: "sm" })}
              data-testid="voice-cancelar"
            >
              Cancelar
            </button>
          </>
        ) : null}
        {state.status === "pidiendo-permiso" ? (
          <button
            type="button"
            onClick={voice.cancel}
            className={buttonClasses({ variant: "secondary", size: "sm" })}
            data-testid="voice-cancelar"
          >
            Cancelar
          </button>
        ) : null}
      </div>

      {listening ? (
        <div className="flex flex-wrap items-center gap-3 text-sm text-fg">
          <span data-testid="voice-escuchando" className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="inline-block size-2.5 animate-pulse rounded-full bg-danger motion-reduce:animate-none"
            />
            Escuchando…
          </span>
          <span role="timer" aria-label="Tiempo grabado" className="tabular-nums text-fg-muted">
            {formatElapsed(state.elapsedMs)}
          </span>
          <div
            ref={levelBox}
            data-testid="voice-nivel"
            data-level="0"
            aria-hidden="true"
            className="flex h-8 items-center gap-1"
          >
            {reduced ? (
              <span className="text-xs tabular-nums text-fg-muted">
                Nivel <span ref={levelNumber}>0</span>
              </span>
            ) : (
              BARS.map((i) => (
                <span
                  key={i}
                  ref={(el) => {
                    barRefs.current[i] = el;
                  }}
                  className="h-full w-1.5 origin-center rounded-pill bg-link"
                  style={{ transform: `scaleY(${barScale(0)})` }}
                />
              ))
            )}
          </div>
        </div>
      ) : null}

      {listening && state.mode === "browser" ? (
        <p
          data-testid="voice-vista-previa"
          className="min-h-11 rounded-lg border border-line bg-surface-subtle px-3 py-2 text-sm"
        >
          {state.final ? <span className="text-fg">{state.final} </span> : null}
          {state.interim ? <span className="text-fg-subtle">{state.interim}</span> : null}
          {!state.final && !state.interim ? (
            <span className="text-fg-subtle">Hablá, el texto aparece acá…</span>
          ) : null}
        </p>
      ) : null}

      {transcribing ? (
        <div data-testid="voice-transcribiendo" className="flex flex-col gap-2">
          <span aria-hidden="true" className="text-sm text-fg">
            Transcribiendo…
          </span>
          <span
            aria-hidden="true"
            className="h-3 w-full max-w-sm animate-pulse rounded-pill bg-surface-strong motion-reduce:animate-none"
          />
          <span
            aria-hidden="true"
            className="h-3 w-2/3 max-w-xs animate-pulse rounded-pill bg-surface-strong motion-reduce:animate-none"
          />
        </div>
      ) : null}

      {/* Anuncios para lectores de pantalla: estado y aviso de corte. El contador no se anuncia cada cuadro */}
      <p role="status" aria-live="polite" className="min-h-5 text-xs text-fg-muted">
        {statusText}
      </p>

      <p id={noteId} className="text-xs text-fg-subtle">
        {note}
      </p>

      {state.status === "error" && state.errorMessage ? (
        <p role="alert" className="text-xs text-danger" data-testid="voice-error">
          {state.errorMessage}
        </p>
      ) : null}
    </div>
  );
}
