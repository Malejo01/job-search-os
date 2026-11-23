"use client";

import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import {
  VOICE_CLIENT_MAX_MS,
  chooseVoicePath,
  voiceErrorMessage,
  type VoiceErrorKind,
  type VoicePath,
} from "@job-search-os/pipeline";
import { getSpeechRecognition } from "@/components/dictar-engine";
import {
  INITIAL_VOICE_STATE,
  createVoiceSession,
  type LevelMeter,
  type RecorderLike,
  type TranscribeResult,
  type VoiceDeps,
  type VoiceSession,
  type VoiceState,
} from "./voice-session";

export type { VoiceState, VoiceStatus } from "./voice-session";

export const TRANSCRIBE_URL = "/api/transcribe";

function createBrowserLevelMeter(stream: MediaStream): LevelMeter | null {
  const Ctx =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  try {
    const ctx = new Ctx();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.6;
    source.connect(analyser); // sin conectar a destination: no suena
    void ctx.resume?.();
    const time = new Uint8Array(analyser.fftSize);
    const freq = new Uint8Array(analyser.frequencyBinCount);
    return {
      getLevel() {
        analyser.getByteTimeDomainData(time);
        let peak = 0;
        for (const v of time) peak = Math.max(peak, Math.abs(v - 128));
        return Math.min(1, peak / 128);
      },
      getLevels(count) {
        analyser.getByteFrequencyData(freq);
        // Solo la zona de la voz (primeros ~2/3 de los bins), repartida en `count` bandas
        const usable = Math.max(count, Math.floor(freq.length * 0.66));
        const per = Math.floor(usable / count);
        return Array.from({ length: count }, (_, i) => {
          let sum = 0;
          for (let j = 0; j < per; j++) sum += freq[i * per + j] ?? 0;
          return Math.min(1, sum / per / 200);
        });
      },
      close() {
        try {
          source.disconnect();
          void ctx.close();
        } catch {
          /* ya cerrado */
        }
      },
    };
  } catch {
    return null;
  }
}

async function uploadToServer(blob: Blob, durationMs: number): Promise<TranscribeResult> {
  const form = new FormData();
  const ext = blob.type.includes("ogg") ? "ogg" : blob.type.includes("mp4") ? "m4a" : "webm";
  form.append("audio", blob, `voz.${ext}`);
  form.append("durationMs", String(Math.round(Math.min(durationMs, VOICE_CLIENT_MAX_MS))));
  const res = await fetch(TRANSCRIBE_URL, { method: "POST", body: form });
  if (res.ok) {
    const body = (await res.json().catch(() => null)) as { text?: unknown } | null;
    return typeof body?.text === "string"
      ? { ok: true, text: body.text }
      : { ok: false, kind: "transcription-failed" };
  }
  const kind: VoiceErrorKind =
    res.status === 429 ? "daily-limit" : res.status === 403 ? "server-off" : "transcription-failed";
  return { ok: false, kind };
}

/** Dependencias del navegador real. Solo se llama en el cliente. */
export function browserVoiceDeps(): VoiceDeps {
  const nav = navigator as Navigator & { brave?: unknown };
  return {
    userAgent: nav.userAgent,
    isBrave: typeof nav.brave === "object" && nav.brave !== null,
    isSecureContext: window.isSecureContext,
    getUserMedia: nav.mediaDevices?.getUserMedia ? (c) => nav.mediaDevices.getUserMedia(c) : null,
    SpeechCtor: getSpeechRecognition(),
    createRecorder: (stream, mime) => {
      if (typeof MediaRecorder === "undefined") return null;
      return new MediaRecorder(
        stream,
        mime ? { mimeType: mime } : undefined,
      ) as unknown as RecorderLike;
    },
    isTypeSupported: (mime) =>
      typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(mime),
    createLevelMeter: createBrowserLevelMeter,
    upload: uploadToServer,
    now: () => Date.now(),
  };
}

export type UseVoiceInputOptions = {
  /** La persona puede transcribir en el servidor (flag `VOICE_SERVER_TRANSCRIBE`). */
  serverTranscribe: boolean;
  /** Recibe el texto al llegar a `listo`. Nunca se envía nada solo: el que lo usa decide. */
  onText?: (text: string) => void;
};

export type UseVoiceInput = {
  state: VoiceState;
  /** Empieza: pide el micrófono y escucha. */
  start: () => void;
  /** «Listo»: termina y entrega el texto. */
  stop: () => void;
  /** «Cancelar»: descarta todo, sin texto. */
  cancel: () => void;
  /** Nivel 0..1 en este instante (para la barra, leelo con requestAnimationFrame). */
  getLevel: () => number;
  /** `count` niveles 0..1 por banda (para las barras). */
  getLevels: (count: number) => number[];
  /**
   * Con `serverTranscribe=false`, el navegador necesita grabar y no hay dónde transcribir: la pantalla
   * muestra el mensaje en vez del botón. `null` hasta que se sabe (en el servidor y en el primer render).
   */
  unsupportedForRecording: boolean | null;
  /** Camino previsto para este navegador (`null` hasta saberlo). En el camino `browser` puede haber respaldo. */
  plannedPath: VoicePath | null;
  /** Texto para mostrar cuando `unsupportedForRecording` es `true`. */
  unavailableMessage: string | null;
};

const subscribeNoop = () => () => {};
const noopSnapshot = () => INITIAL_VOICE_STATE;

/**
 * Hook de entrada por voz. Estados: `idle | pidiendo-permiso | escuchando | transcribiendo | listo | error`.
 * Libera el stream y los tracks siempre: al terminar, cancelar, fallar y desmontar.
 */
export function useVoiceInput(options: UseVoiceInputOptions): UseVoiceInput {
  const onTextRef = useRef(options.onText);
  const sessionRef = useRef<VoiceSession | null>(null);

  useEffect(() => {
    onTextRef.current = options.onText;
  });

  // La sesión se crea en el cliente, la primera vez que se la necesita
  const getSession = useCallback((): VoiceSession => {
    if (!sessionRef.current) {
      sessionRef.current = createVoiceSession(browserVoiceDeps(), {
        serverTranscribe: options.serverTranscribe,
        onText: (t) => onTextRef.current?.(t),
      });
    }
    return sessionRef.current;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    sessionRef.current?.setServerTranscribe(options.serverTranscribe);
  }, [options.serverTranscribe]);

  useEffect(
    () => () => {
      sessionRef.current?.dispose();
      sessionRef.current = null;
    },
    [],
  );

  // subscribe y getSnapshot solo corren en el cliente; en el servidor se usa el estado inicial
  const subscribe = useCallback((cb: () => void) => getSession().subscribe(cb), [getSession]);
  const state = useSyncExternalStore(subscribe, () => getSession().getState(), noopSnapshot);

  // El camino que se va a usar y, si no se puede dictar acá, el texto que lo explica (strings: snapshot estable)
  const plannedPath = useSyncExternalStore(
    subscribeNoop,
    (): VoicePath => {
      const d = browserVoiceDeps();
      return chooseVoicePath({
        userAgent: d.userAgent,
        hasSpeechRecognition: d.SpeechCtor !== null,
        isBrave: d.isBrave,
      });
    },
    (): VoicePath | null => null,
  );
  const unsupportedForRecording =
    plannedPath === null ? null : plannedPath === "record" && !options.serverTranscribe;
  const unavailableMessage = useSyncExternalStore(
    subscribeNoop,
    () => {
      const d = browserVoiceDeps();
      return voiceErrorMessage("server-off", d.userAgent, { isBrave: d.isBrave });
    },
    () => null,
  );

  return useMemo(
    () => ({
      plannedPath,
      unavailableMessage,
      state,
      start: () => void getSession().start(),
      stop: () => getSession().stop(),
      cancel: () => getSession().cancel(),
      getLevel: () => sessionRef.current?.getLevel() ?? 0,
      getLevels: (count: number) =>
        sessionRef.current?.getLevels(count) ?? Array.from({ length: count }, () => 0),
      unsupportedForRecording,
    }),
    [state, getSession, unsupportedForRecording, plannedPath, unavailableMessage],
  );
}
