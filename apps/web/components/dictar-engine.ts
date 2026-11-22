/**
 * Motor de «Dictar» (Web Speech API), sin React ni DOM para poder probarlo con un mock. Reconoce voz en el
 * navegador: el audio no pasa por nuestros servidores (el navegador puede mandarlo a su proveedor para
 * transcribirlo, y la pantalla lo avisa). Nada se graba ni se guarda: solo se arma texto para el campo.
 */

export const DICTAR_LANG = "es-AR";

type SpeechAlternativeLike = { transcript: string };
type SpeechResultLike = { isFinal: boolean; 0: SpeechAlternativeLike; length: number };
export type SpeechEventLike = {
  resultIndex?: number;
  results: { length: number; [index: number]: SpeechResultLike };
};

export interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives?: number;
  onresult: ((event: SpeechEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort?(): void;
}
export type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

/** El constructor del navegador, o `null` si no hay soporte (entonces el botón no se muestra). */
export function getSpeechRecognition(
  scope: unknown = typeof window === "undefined" ? undefined : window,
): SpeechRecognitionCtor | null {
  if (!scope || typeof scope !== "object") return null;
  const w = scope as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
  const ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return typeof ctor === "function" ? (ctor as SpeechRecognitionCtor) : null;
}

/** Une lo que ya estaba escrito con lo dictado, con un solo espacio entre ambos. */
export function joinDictated(base: string, spoken: string): string {
  const said = spoken.trim();
  if (said === "") return base;
  if (base.trim() === "") return said;
  return `${base.replace(/\s+$/, "")} ${said}`;
}

export type DictationErrorCode = "denied" | "no-speech" | "unavailable" | "other";

export function errorCodeOf(raw: string | undefined): DictationErrorCode {
  if (raw === "not-allowed" || raw === "service-not-allowed") return "denied";
  if (raw === "no-speech") return "no-speech";
  if (raw === "audio-capture" || raw === "network" || raw === "language-not-supported") {
    return "unavailable";
  }
  return "other";
}

export type DictationOptions = {
  Ctor: SpeechRecognitionCtor;
  lang?: string;
  /** Texto del campo en el momento de empezar: lo dictado se agrega después. */
  getBase: () => string;
  /** Texto completo del campo (lo previo más lo dictado, con resultados intermedios en vivo). */
  onText: (text: string) => void;
  onListening: (listening: boolean) => void;
  onError?: (code: DictationErrorCode) => void;
  maxLength?: number;
};

export type Dictation = {
  start(): void;
  /** Corta y deja que llegue el último texto. */
  stop(): void;
  /** Corta y descarta lo que falte llegar. */
  cancel(): void;
  readonly listening: boolean;
};

export function createDictation(opts: DictationOptions): Dictation {
  let rec: SpeechRecognitionLike | null = null;
  let base = "";
  const cap = (s: string) => (opts.maxLength ? s.slice(0, opts.maxLength) : s);

  const finish = () => {
    if (!rec) return;
    rec = null;
    opts.onListening(false);
  };

  return {
    get listening() {
      return rec !== null;
    },
    start() {
      if (rec) return;
      let r: SpeechRecognitionLike;
      try {
        r = new opts.Ctor();
      } catch {
        opts.onError?.("unavailable");
        return;
      }
      base = opts.getBase();
      r.lang = opts.lang ?? DICTAR_LANG;
      r.continuous = true;
      r.interimResults = true;
      r.onresult = (event) => {
        let spoken = "";
        for (let i = 0; i < event.results.length; i++) {
          const res = event.results[i];
          if (res) spoken += res[0].transcript;
        }
        opts.onText(cap(joinDictated(base, spoken)));
      };
      r.onerror = (event) => opts.onError?.(errorCodeOf(event.error));
      r.onend = finish;
      rec = r;
      try {
        r.start();
        opts.onListening(true);
      } catch {
        rec = null;
        opts.onError?.("unavailable");
      }
    },
    stop() {
      if (!rec) return;
      try {
        rec.stop();
      } catch {
        finish();
      }
    },
    cancel() {
      if (!rec) return;
      // Sin más texto en el campo (por ejemplo, ya se envió): se descarta lo que falte llegar
      rec.onresult = null;
      try {
        rec.stop();
      } catch {
        /* ya estaba cortado */
      }
      finish();
    },
  };
}
