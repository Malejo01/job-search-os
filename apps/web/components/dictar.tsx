"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { buttonClasses } from "@/components/ui";
import {
  createDictation,
  getSpeechRecognition,
  type Dictation,
  type DictationErrorCode,
} from "@/components/dictar-engine";

export const DICTAR_PRIVACY_NOTE =
  "El navegador puede mandar el audio a su proveedor para transcribirlo; nosotros no lo grabamos ni lo guardamos.";

const ERRORS: Partial<Record<DictationErrorCode, string>> = {
  denied: "No tenemos permiso para usar el micrófono. Habilitalo en el navegador y probá de nuevo.",
  unavailable: "El dictado no está disponible ahora. Podés escribir la respuesta.",
  other: "No pudimos seguir con el dictado. Podés escribir la respuesta.",
};

const subscribe = () => () => {};
const supported = () => getSpeechRecognition() !== null;
const notOnServer = () => false;

export type DictarProps = {
  /** Texto actual del campo (controlado por quien usa el componente). */
  value: string;
  /** Recibe el texto completo del campo: lo escrito antes más lo dictado, en vivo. */
  onChange: (text: string) => void;
  disabled?: boolean;
  /** Tope de caracteres del campo (el dictado no lo pasa). */
  maxLength?: number;
  /** Idioma del reconocimiento. Por defecto `es-AR`. */
  lang?: string;
  className?: string;
};

/**
 * Botón «Dictar» (Web Speech API). Si el navegador no tiene reconocimiento de voz no se muestra nada. El texto
 * cae en el campo para editarlo antes de enviar; el audio no pasa por nuestros servidores ni se guarda.
 */
export function Dictar({ value, onChange, disabled, maxLength, lang, className }: DictarProps) {
  const noteId = useId();
  const available = useSyncExternalStore(subscribe, supported, notOnServer);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<DictationErrorCode | null>(null);
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const engine = useRef<Dictation | null>(null);

  useEffect(() => {
    valueRef.current = value;
    onChangeRef.current = onChange;
  });

  // Se corta al desmontar o al deshabilitar el campo (por ejemplo, mientras se envía)
  useEffect(() => {
    if (disabled) engine.current?.cancel();
  }, [disabled]);
  useEffect(() => () => engine.current?.cancel(), []);

  if (!available) return null;

  function toggle() {
    if (listening) return engine.current?.stop();
    const Ctor = getSpeechRecognition();
    if (!Ctor) return;
    setError(null);
    engine.current = createDictation({
      Ctor,
      lang,
      maxLength,
      getBase: () => valueRef.current,
      onText: (text) => onChangeRef.current(text),
      onListening: setListening,
      onError: (code) => setError(code === "no-speech" ? null : code),
    });
    engine.current.start();
  }

  return (
    <div className={className ?? "flex flex-col gap-1"} data-testid="dictar">
      <button
        type="button"
        onClick={toggle}
        disabled={disabled}
        aria-pressed={listening}
        aria-describedby={noteId}
        className={buttonClasses({ variant: listening ? "primary" : "secondary", size: "sm" })}
        data-testid="dictar-boton"
      >
        {listening ? "Dejar de dictar" : "Dictar"}
      </button>
      <p id={noteId} className="text-xs text-fg-subtle">
        {DICTAR_PRIVACY_NOTE}
      </p>
      <p role="status" className="text-xs text-danger" data-testid="dictar-error">
        {error ? ERRORS[error] : null}
      </p>
    </div>
  );
}
