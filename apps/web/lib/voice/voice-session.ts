/**
 * Sesión de voz (R25-01), sin React ni DOM directo: todo lo del navegador entra por `VoiceDeps`, así se prueba
 * con fakes. El hook `use-voice-input.ts` la conecta a React y al navegador real.
 *
 * Flujo: `getUserMedia({ audio: true })` primero (fuerza el cartel de permiso y da el stream); la grabación
 * arranca siempre desde ese stream y Web Speech corre en paralelo cuando el navegador lo soporta. Si el
 * reconocimiento falla o se cuelga, se sigue en modo grabación sin perder lo hablado. El audio vive solo en
 * memoria: se sube a `/api/transcribe` y se descarta.
 */
import {
  VOICE_CLIENT_MAX_MS,
  chooseVoicePath,
  pickRecordingMime,
  recordingTimeState,
  shouldFallBackToRecording,
  voiceErrorKindFromName,
  voiceErrorMessage,
  type VoiceErrorKind,
  type VoicePath,
} from "@job-search-os/pipeline";
import type {
  SpeechEventLike,
  SpeechRecognitionCtor,
  SpeechRecognitionLike,
} from "../../components/dictar-engine";

export type VoiceStatus =
  "idle" | "pidiendo-permiso" | "escuchando" | "transcribiendo" | "listo" | "error";

export type VoiceState = {
  status: VoiceStatus;
  /** Camino en uso: `browser` (texto en vivo) o `record` (se transcribe al terminar). `null` en reposo. */
  mode: VoicePath | null;
  /** Texto ya definitivo del reconocimiento del navegador. */
  final: string;
  /** Texto parcial (todavía puede cambiar). */
  interim: string;
  /** Texto entregado al terminar (`listo`). Vacío si no se dijo nada. */
  text: string;
  elapsedMs: number;
  /** Pasó 1:45: el corte a los 2 min está cerca. */
  warning: boolean;
  error: VoiceErrorKind | null;
  errorMessage: string | null;
  /** El stream abierto, para que la UI lo analice. `null` cuando se liberó. */
  stream: MediaStream | null;
};

export const INITIAL_VOICE_STATE: VoiceState = {
  status: "idle",
  mode: null,
  final: "",
  interim: "",
  text: "",
  elapsedMs: 0,
  warning: false,
  error: null,
  errorMessage: null,
  stream: null,
};

export type RecorderLike = {
  ondataavailable: ((event: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  readonly state: string;
  start(timesliceMs?: number): void;
  stop(): void;
};

export type LevelMeter = {
  /** Nivel general 0..1. */
  getLevel(): number;
  /**
   * Nivel máximo (0..1) desde la última vez que se llamó, con pico retenido: así un bip o una sílaba entre dos
   * ticks no se pierde. Si el medidor no lo tiene, se usa `getLevel()` (nivel instantáneo).
   */
  takePeak?(): number;
  /** `count` niveles 0..1 por banda de frecuencia, para las barras. */
  getLevels(count: number): number[];
  close(): void;
};

export type TranscribeResult = { ok: true; text: string } | { ok: false; kind: VoiceErrorKind };

export type VoiceDeps = {
  userAgent: string;
  isBrave: boolean;
  isSecureContext: boolean;
  getUserMedia: ((constraints: { audio: boolean }) => Promise<MediaStream>) | null;
  SpeechCtor: SpeechRecognitionCtor | null;
  createRecorder: (stream: MediaStream, mime: string | null) => RecorderLike | null;
  isTypeSupported: (mime: string) => boolean;
  createLevelMeter: (stream: MediaStream) => LevelMeter | null;
  upload: (blob: Blob, durationMs: number) => Promise<TranscribeResult>;
  now: () => number;
  lang?: string;
};

export type VoiceSessionOptions = {
  /** El servidor transcribe (flag `VOICE_SERVER_TRANSCRIBE` para esta persona). */
  serverTranscribe: boolean;
  /** Se llama una sola vez al llegar a `listo` con el texto (puede ser vacío). */
  onText?: (text: string) => void;
};

/** Nivel (0..1) por encima del cual hay señal de voz. */
export const VOICE_SIGNAL_LEVEL = 0.06;
const TICK_MS = 250;
const STOP_WAIT_MS = 1500;

export type VoiceSession = {
  getState(): VoiceState;
  subscribe(listener: () => void): () => void;
  start(): Promise<void>;
  /** «Listo»: termina y entrega el texto. */
  stop(): void;
  /** «Cancelar»: descarta todo, sin texto. */
  cancel(): void;
  getLevel(): number;
  getLevels(count: number): number[];
  setServerTranscribe(value: boolean): void;
  dispose(): void;
};

function joinText(a: string, b: string): string {
  const x = a.trim();
  const y = b.trim();
  return x && y ? `${x} ${y}` : x || y;
}

export function createVoiceSession(deps: VoiceDeps, options: VoiceSessionOptions): VoiceSession {
  let state: VoiceState = INITIAL_VOICE_STATE;
  const listeners = new Set<() => void>();
  let serverTranscribe = options.serverTranscribe;

  let run = 0;
  let stream: MediaStream | null = null;
  let recorder: RecorderLike | null = null;
  let chunks: Blob[] = [];
  let meter: LevelMeter | null = null;
  let recognition: SpeechRecognitionLike | null = null;
  let tickTimer: ReturnType<typeof setInterval> | null = null;
  let stopTimer: ReturnType<typeof setTimeout> | null = null;
  let startedAt = 0;
  let gotResult = false;
  let signalSeen = false;
  let finishing = false;

  const set = (patch: Partial<VoiceState>) => {
    state = { ...state, ...patch };
    for (const l of [...listeners]) l();
  };

  const releaseStream = () => {
    meter?.close();
    meter = null;
    if (stream) for (const t of stream.getTracks()) t.stop();
    stream = null;
  };

  const killRecognition = () => {
    const r = recognition;
    recognition = null;
    if (!r) return;
    r.onresult = null;
    r.onerror = null;
    r.onend = null;
    try {
      (r.abort ?? r.stop).call(r);
    } catch {
      /* ya estaba cortado */
    }
  };

  const killRecorder = () => {
    const r = recorder;
    recorder = null;
    chunks = [];
    if (!r) return;
    r.ondataavailable = null;
    r.onstop = null;
    try {
      if (r.state !== "inactive") r.stop();
    } catch {
      /* ya estaba cortado */
    }
  };

  const clearTimers = () => {
    if (tickTimer) clearInterval(tickTimer);
    if (stopTimer) clearTimeout(stopTimer);
    tickTimer = null;
    stopTimer = null;
  };

  /** Libera todo (stream, tracks, recorder, reconocimiento, timers). */
  const teardown = () => {
    clearTimers();
    killRecognition();
    killRecorder();
    releaseStream();
  };

  const fail = (kind: VoiceErrorKind) => {
    teardown();
    finishing = false;
    set({
      status: "error",
      error: kind,
      errorMessage: voiceErrorMessage(kind, deps.userAgent, { isBrave: deps.isBrave }),
      interim: "",
      stream: null,
    });
  };

  const deliver = (text: string) => {
    teardown();
    finishing = false;
    set({ status: "listo", text, final: text, interim: "", stream: null });
    options.onText?.(text);
  };

  /** Pasa de Web Speech a grabación sin perder lo hablado: la grabación ya venía corriendo. */
  const fallBackToRecording = () => {
    if (state.mode === "record") return;
    killRecognition();
    if (!serverTranscribe) return fail("server-off");
    set({ mode: "record", final: "", interim: "" });
  };

  const startRecognition = (Ctor: SpeechRecognitionCtor) => {
    let r: SpeechRecognitionLike;
    try {
      r = new Ctor();
    } catch {
      return fallBackToRecording();
    }
    r.lang = deps.lang ?? "es-AR";
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (event: SpeechEventLike) => {
      // Un resultado tardío de un reconocimiento ya descartado (se pasó a grabación) no cuenta
      if (recognition !== r || state.mode !== "browser") return;
      gotResult = true;
      let final = "";
      let interim = "";
      for (let i = 0; i < event.results.length; i++) {
        const res = event.results[i];
        if (!res) continue;
        if (res.isFinal) final += res[0].transcript;
        else interim += res[0].transcript;
      }
      set({ final: final.trim(), interim: interim.trim() });
    };
    r.onerror = (event) => {
      if (shouldFallBackToRecording({ kind: "error", code: event.error })) fallBackToRecording();
    };
    r.onend = () => {
      if (recognition !== r) return;
      recognition = null;
      if (state.status === "escuchando" && state.mode === "browser") finish();
    };
    recognition = r;
    try {
      r.start();
    } catch {
      recognition = null;
      fallBackToRecording();
    }
  };

  const tick = () => {
    if (state.status !== "escuchando") return;
    const elapsedMs = deps.now() - startedAt;
    // «Hubo señal» = el nivel pasó el umbral en algún momento desde el tick anterior, no justo en este instante
    if (meter && (meter.takePeak ? meter.takePeak() : meter.getLevel()) > VOICE_SIGNAL_LEVEL) {
      signalSeen = true;
    }
    const time = recordingTimeState(elapsedMs);
    set({ elapsedMs, warning: time !== "ok" });
    if (time === "cut") return finish();
    if (
      state.mode === "browser" &&
      !gotResult &&
      shouldFallBackToRecording({ kind: "no-result", elapsedMs, hasSignal: signalSeen })
    ) {
      fallBackToRecording();
    }
  };

  const transcribe = () => {
    const r = recorder;
    const durationMs = Math.min(deps.now() - startedAt, VOICE_CLIENT_MAX_MS);
    const done = async () => {
      const parts = chunks;
      chunks = [];
      recorder = null;
      const type = parts[0]?.type || "audio/webm";
      const blob = new Blob(parts, { type });
      releaseStream();
      clearTimers();
      if (blob.size === 0) return deliver("");
      let result: TranscribeResult;
      try {
        result = await deps.upload(blob, durationMs);
      } catch {
        result = { ok: false, kind: "transcription-failed" };
      }
      if (state.status !== "transcribiendo") return; // se canceló mientras subía
      if (result.ok) deliver(result.text.trim());
      else fail(result.kind);
    };
    set({ status: "transcribiendo", stream: null });
    if (!r || r.state === "inactive") {
      void done();
      return;
    }
    r.onstop = () => void done();
    try {
      r.stop();
    } catch {
      void done();
    }
  };

  /** «Listo» o corte por tiempo. */
  function finish() {
    if (state.status !== "escuchando" || finishing) return;
    finishing = true;
    if (state.mode === "record") return transcribe();

    // Web Speech: se pide el último resultado y se espera el cierre (con tope por si no llega)
    const r = recognition;
    const collect = () => {
      const text = joinText(state.final, state.interim);
      if (text === "" && signalSeen && serverTranscribe && recorder) {
        // Se habló pero el navegador no devolvió nada: se transcribe la grabación
        set({ mode: "record" });
        finishing = true;
        return transcribe();
      }
      deliver(text);
    };
    if (!r) return collect();
    r.onend = () => {
      recognition = null;
      if (stopTimer) clearTimeout(stopTimer);
      collect();
    };
    stopTimer = setTimeout(() => {
      killRecognition();
      collect();
    }, STOP_WAIT_MS);
    try {
      r.stop();
    } catch {
      killRecognition();
      if (stopTimer) clearTimeout(stopTimer);
      collect();
    }
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async start() {
      if (state.status === "pidiendo-permiso" || state.status === "escuchando" || finishing) return;
      if (state.status === "transcribiendo") return;
      const myRun = ++run;
      teardown();
      gotResult = false;
      signalSeen = false;
      finishing = false;
      set({ ...INITIAL_VOICE_STATE, status: "pidiendo-permiso" });

      if (!deps.isSecureContext) return fail("insecure-context");
      if (!deps.getUserMedia) return fail("unavailable");

      const path = chooseVoicePath({
        userAgent: deps.userAgent,
        hasSpeechRecognition: deps.SpeechCtor !== null,
        isBrave: deps.isBrave,
      });
      // Sin transcripción en el servidor, un navegador que necesita grabar no puede dictar: no se pide permiso
      if (path === "record" && !serverTranscribe) return fail("server-off");

      let media: MediaStream;
      try {
        media = await deps.getUserMedia({ audio: true });
      } catch (err) {
        if (myRun !== run) return;
        return fail(voiceErrorKindFromName((err as { name?: string } | null)?.name));
      }
      // `state` cambia mientras se espera el permiso (cancelar): se lee de nuevo, sin el estrechamiento de TS
      if (myRun !== run || (state as VoiceState).status !== "pidiendo-permiso") {
        for (const t of media.getTracks()) t.stop(); // se canceló mientras se pedía el permiso
        return;
      }
      stream = media;
      meter = deps.createLevelMeter(media);

      // La grabación arranca ya, desde el principio: es el respaldo si el dictado del navegador falla
      const mime = pickRecordingMime(deps.isTypeSupported);
      if (path === "record" || serverTranscribe) {
        try {
          recorder = deps.createRecorder(media, mime);
        } catch {
          recorder = null;
        }
        if (recorder) {
          recorder.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) chunks.push(e.data);
          };
          try {
            recorder.start(1000);
          } catch {
            recorder = null;
          }
        }
        if (!recorder && path === "record") return fail("unavailable");
      }

      startedAt = deps.now();
      set({ status: "escuchando", mode: path, stream: media, elapsedMs: 0 });
      tickTimer = setInterval(tick, TICK_MS);
      if (path === "browser" && deps.SpeechCtor) startRecognition(deps.SpeechCtor);
    },
    stop: finish,
    cancel() {
      run++;
      teardown();
      finishing = false;
      set({ ...INITIAL_VOICE_STATE });
    },
    getLevel: () => meter?.getLevel() ?? 0,
    getLevels: (count) => meter?.getLevels(count) ?? Array.from({ length: count }, () => 0),
    setServerTranscribe(value) {
      serverTranscribe = value;
    },
    dispose() {
      run++;
      teardown();
      listeners.clear();
      state = INITIAL_VOICE_STATE;
    },
  };
}
