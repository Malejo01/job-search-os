import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createVoiceSession,
  type LevelMeter,
  type RecorderLike,
  type TranscribeResult,
  type VoiceDeps,
} from "../lib/voice/voice-session";
import type { SpeechEventLike, SpeechRecognitionLike } from "../components/dictar-engine";

const UA_CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const UA_OPERA = `${UA_CHROME} OPR/115.0.0.0`;
const UA_FIREFOX =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0";

class FakeTrack {
  stopped = false;
  stop() {
    this.stopped = true;
  }
}
class FakeStream {
  tracks = [new FakeTrack(), new FakeTrack()];
  getTracks() {
    return this.tracks;
  }
}

class FakeRecorder implements RecorderLike {
  static last: FakeRecorder | null = null;
  ondataavailable: RecorderLike["ondataavailable"] = null;
  onstop: RecorderLike["onstop"] = null;
  state = "inactive";
  mime: string | null;
  constructor(mime: string | null) {
    this.mime = mime;
    FakeRecorder.last = this;
  }
  start() {
    this.state = "recording";
  }
  chunk(text = "xx") {
    this.ondataavailable?.({ data: new Blob([text], { type: "audio/webm" }) });
  }
  stop() {
    this.state = "inactive";
    this.chunk("fin");
    this.onstop?.();
  }
}

class FakeRecognition implements SpeechRecognitionLike {
  static last: FakeRecognition | null = null;
  lang = "";
  continuous = false;
  interimResults = false;
  onresult: SpeechRecognitionLike["onresult"] = null;
  onerror: SpeechRecognitionLike["onerror"] = null;
  onend: SpeechRecognitionLike["onend"] = null;
  started = false;
  aborted = false;
  constructor() {
    FakeRecognition.last = this;
  }
  start() {
    this.started = true;
  }
  stop() {
    this.onend?.();
  }
  abort() {
    this.aborted = true;
  }
  say(parts: { t: string; final: boolean }[]) {
    const results = parts.map((p) => Object.assign([{ transcript: p.t }], { isFinal: p.final }));
    this.onresult?.({
      results: Object.assign(results, { length: results.length }),
    } as unknown as SpeechEventLike);
  }
}

type Harness = {
  deps: VoiceDeps;
  stream: FakeStream;
  level: { value: number; peak: number };
  upload: ReturnType<typeof vi.fn>;
  getUserMedia: ReturnType<typeof vi.fn>;
};

function harness(
  over: Partial<VoiceDeps> = {},
  uploadResult: TranscribeResult = { ok: true, text: "  hola desde el servidor " },
): Harness {
  const stream = new FakeStream();
  // `value`: nivel instantáneo. `peak`: lo más alto que pasó entre dos ticks (pico retenido), se consume al leerlo
  const level = { value: 0, peak: 0 };
  const upload = vi.fn(async () => uploadResult);
  const getUserMedia = vi.fn(async () => stream as unknown as MediaStream);
  const meter: LevelMeter = {
    getLevel: () => level.value,
    takePeak: () => {
      const p = Math.max(level.value, level.peak);
      level.peak = 0;
      return p;
    },
    getLevels: (n) => Array.from({ length: n }, () => level.value),
    close: () => {},
  };
  const deps: VoiceDeps = {
    userAgent: UA_CHROME,
    isBrave: false,
    isSecureContext: true,
    getUserMedia,
    SpeechCtor: FakeRecognition,
    createRecorder: (_s, mime) => new FakeRecorder(mime),
    isTypeSupported: () => true,
    createLevelMeter: () => meter,
    upload,
    now: () => Date.now(),
    ...over,
  };
  return { deps, stream, level, upload, getUserMedia };
}

const allStopped = (s: FakeStream) => s.tracks.every((t) => t.stopped);

beforeEach(() => {
  vi.useFakeTimers();
  FakeRecorder.last = null;
  FakeRecognition.last = null;
});
afterEach(() => {
  vi.useRealTimers();
});

describe("camino del navegador (Chrome)", () => {
  it("pide el micrófono primero, muestra el texto en vivo y entrega al tocar Listo", async () => {
    const h = harness();
    const onText = vi.fn();
    const s = createVoiceSession(h.deps, { serverTranscribe: false, onText });
    const p = s.start();
    expect(s.getState().status).toBe("pidiendo-permiso");
    await p;
    expect(h.getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(s.getState().status).toBe("escuchando");
    expect(s.getState().mode).toBe("browser");
    expect(FakeRecognition.last?.started).toBe(true);
    expect(FakeRecognition.last?.lang).toBe("es-AR");

    FakeRecognition.last!.say([
      { t: "buenas tardes ", final: true },
      { t: "quiero", final: false },
    ]);
    expect(s.getState().final).toBe("buenas tardes");
    expect(s.getState().interim).toBe("quiero");

    s.stop();
    expect(s.getState().status).toBe("listo");
    expect(s.getState().text).toBe("buenas tardes quiero");
    expect(onText).toHaveBeenCalledTimes(1);
    expect(onText).toHaveBeenCalledWith("buenas tardes quiero");
    expect(h.upload).not.toHaveBeenCalled();
    expect(allStopped(h.stream)).toBe(true);
    expect(s.getState().stream).toBeNull();
  });

  it("sin servidor no graba: no hay respaldo que guardar", async () => {
    const h = harness();
    const s = createVoiceSession(h.deps, { serverTranscribe: false });
    await s.start();
    expect(FakeRecorder.last).toBeNull();
    s.cancel();
  });

  it("el contador avanza y el aviso aparece a 1:45", async () => {
    const h = harness();
    const s = createVoiceSession(h.deps, { serverTranscribe: false });
    await s.start();
    FakeRecognition.last!.say([{ t: "hola", final: true }]);
    vi.advanceTimersByTime(10_000);
    expect(s.getState().elapsedMs).toBeGreaterThanOrEqual(9_750);
    expect(s.getState().warning).toBe(false);
    vi.advanceTimersByTime(96_000);
    expect(s.getState().warning).toBe(true);
    expect(s.getState().status).toBe("escuchando");
    s.cancel();
  });
});

describe("pasar a grabación sin perder lo hablado", () => {
  it("el error network cambia a grabación y sube el audio desde el principio", async () => {
    const h = harness();
    const onText = vi.fn();
    const s = createVoiceSession(h.deps, { serverTranscribe: true, onText });
    await s.start();
    expect(FakeRecorder.last?.state).toBe("recording");
    FakeRecorder.last!.chunk("antes");
    FakeRecognition.last!.onerror?.({ error: "network" });
    expect(s.getState().mode).toBe("record");
    expect(s.getState().status).toBe("escuchando");
    expect(FakeRecognition.last?.aborted).toBe(true);

    s.stop();
    expect(s.getState().status).toBe("transcribiendo");
    await vi.advanceTimersByTimeAsync(0);
    expect(h.upload).toHaveBeenCalledTimes(1);
    const [blob] = h.upload.mock.calls[0] as unknown as [Blob, number];
    expect(blob.size).toBe("antes".length + "fin".length);
    expect(s.getState().status).toBe("listo");
    expect(s.getState().text).toBe("hola desde el servidor");
    expect(onText).toHaveBeenCalledWith("hola desde el servidor");
    expect(allStopped(h.stream)).toBe(true);
  });

  it("un resultado tardío del navegador después de pasar a grabación no gana: el texto final es el del servidor", async () => {
    const h = harness();
    const onText = vi.fn();
    const s = createVoiceSession(h.deps, { serverTranscribe: true, onText });
    await s.start();
    const rec = FakeRecognition.last!;
    const staleResult = rec.onresult!;
    const staleEnd = rec.onend!;
    h.level.value = 0.4;
    vi.advanceTimersByTime(4_500);
    expect(s.getState().mode).toBe("record");

    // Llega tarde, por una referencia vieja: ni el estado ni el texto cambian
    staleResult({
      results: Object.assign(
        [Object.assign([{ transcript: "texto del navegador" }], { isFinal: true })],
        {
          length: 1,
        },
      ),
    } as unknown as SpeechEventLike);
    staleEnd();
    expect(s.getState().final).toBe("");
    expect(s.getState().interim).toBe("");
    expect(s.getState().status).toBe("escuchando");

    s.stop();
    await vi.advanceTimersByTimeAsync(0);
    expect(s.getState().text).toBe("hola desde el servidor");
    expect(onText).toHaveBeenCalledTimes(1);
    expect(onText).toHaveBeenCalledWith("hola desde el servidor");
  });

  it.each(["service-not-allowed", "not-allowed"])(
    "el error %s también cambia a grabación",
    async (code) => {
      const h = harness();
      const s = createVoiceSession(h.deps, { serverTranscribe: true });
      await s.start();
      FakeRecognition.last!.onerror?.({ error: code });
      expect(s.getState().mode).toBe("record");
      s.cancel();
    },
  );

  it("no-speech no cambia de camino", async () => {
    const h = harness();
    const s = createVoiceSession(h.deps, { serverTranscribe: true });
    await s.start();
    FakeRecognition.last!.onerror?.({ error: "no-speech" });
    expect(s.getState().mode).toBe("browser");
    s.cancel();
  });

  it("4 s sin resultado con señal de audio cambia a grabación", async () => {
    const h = harness();
    const s = createVoiceSession(h.deps, { serverTranscribe: true });
    await s.start();
    h.level.value = 0.4;
    vi.advanceTimersByTime(3_000);
    expect(s.getState().mode).toBe("browser");
    vi.advanceTimersByTime(1_500);
    expect(s.getState().mode).toBe("record");
    s.cancel();
  });

  it("señal intermitente (bips entre ticks, justo en cada tick hay silencio) también cuenta: pasa a grabación", async () => {
    const h = harness();
    const s = createVoiceSession(h.deps, { serverTranscribe: true });
    await s.start();
    h.level.value = 0; // en el instante de cada tick no se oye nada
    for (let i = 0; i < 18; i++) {
      if (i === 2) h.level.peak = 0.5; // un bip corto entre dos ticks
      vi.advanceTimersByTime(250);
    }
    expect(s.getState().mode).toBe("record");
    s.cancel();
  });

  it("silencio real (ni instantáneo ni pico) no pasa a grabación", async () => {
    const h = harness();
    const s = createVoiceSession(h.deps, { serverTranscribe: true });
    await s.start();
    h.level.value = 0.01;
    for (let i = 0; i < 40; i++) {
      h.level.peak = 0.03;
      vi.advanceTimersByTime(250);
    }
    expect(s.getState().mode).toBe("browser");
    s.cancel();
  });

  it("sin takePeak se usa el nivel instantáneo", async () => {
    const level = { value: 0 };
    const h = harness({
      createLevelMeter: () => ({
        getLevel: () => level.value,
        getLevels: (n) => Array.from({ length: n }, () => level.value),
        close: () => {},
      }),
    });
    const s = createVoiceSession(h.deps, { serverTranscribe: true });
    await s.start();
    level.value = 0.4;
    vi.advanceTimersByTime(4_500);
    expect(s.getState().mode).toBe("record");
    s.cancel();
  });

  it("4 s sin resultado y sin señal (silencio) no cambia", async () => {
    const h = harness();
    const s = createVoiceSession(h.deps, { serverTranscribe: true });
    await s.start();
    h.level.value = 0;
    vi.advanceTimersByTime(8_000);
    expect(s.getState().mode).toBe("browser");
    s.cancel();
  });

  it("si ya llegó un resultado, el silencio posterior no cambia", async () => {
    const h = harness();
    const s = createVoiceSession(h.deps, { serverTranscribe: true });
    await s.start();
    h.level.value = 0.4;
    FakeRecognition.last!.say([{ t: "hola", final: false }]);
    vi.advanceTimersByTime(10_000);
    expect(s.getState().mode).toBe("browser");
    s.cancel();
  });

  it("con el servidor apagado, el fallo del navegador termina con server-off y libera el micrófono", async () => {
    const h = harness();
    const s = createVoiceSession(h.deps, { serverTranscribe: false });
    await s.start();
    FakeRecognition.last!.onerror?.({ error: "network" });
    expect(s.getState().status).toBe("error");
    expect(s.getState().error).toBe("server-off");
    expect(allStopped(h.stream)).toBe(true);
  });
});

describe("camino de grabación (Opera, Firefox, Brave)", () => {
  it.each([
    ["Opera", UA_OPERA, false],
    ["Firefox", UA_FIREFOX, false],
    ["Brave", UA_CHROME, true],
  ])("%s graba, sube y entrega el texto", async (_n, ua, brave) => {
    const h = harness({ userAgent: ua, isBrave: brave });
    const onText = vi.fn();
    const s = createVoiceSession(h.deps, { serverTranscribe: true, onText });
    await s.start();
    expect(s.getState().mode).toBe("record");
    expect(FakeRecognition.last).toBeNull(); // no se usa el reconocimiento que falla en silencio
    expect(FakeRecorder.last?.mime).toBe("audio/webm;codecs=opus");
    vi.advanceTimersByTime(5_000);
    s.stop();
    expect(s.getState().status).toBe("transcribiendo");
    await vi.advanceTimersByTimeAsync(0);
    const [, durationMs] = h.upload.mock.calls[0] as unknown as [Blob, number];
    expect(durationMs).toBeGreaterThanOrEqual(4_750);
    expect(durationMs).toBeLessThanOrEqual(5_250);
    expect(s.getState().status).toBe("listo");
    expect(onText).toHaveBeenCalledWith("hola desde el servidor");
    expect(allStopped(h.stream)).toBe(true);
  });

  it("Firefox sin API de reconocimiento también graba", async () => {
    const h = harness({ userAgent: UA_FIREFOX, SpeechCtor: null });
    const s = createVoiceSession(h.deps, { serverTranscribe: true });
    await s.start();
    expect(s.getState().mode).toBe("record");
    s.cancel();
  });

  it("con el servidor apagado no pide el micrófono: dice que no está disponible", async () => {
    const h = harness({ userAgent: UA_OPERA });
    const s = createVoiceSession(h.deps, { serverTranscribe: false });
    await s.start();
    expect(h.getUserMedia).not.toHaveBeenCalled();
    expect(s.getState().status).toBe("error");
    expect(s.getState().error).toBe("server-off");
  });

  it("el tope del día (429) termina en error daily-limit y libera todo", async () => {
    const h = harness({ userAgent: UA_OPERA }, { ok: false, kind: "daily-limit" });
    const onText = vi.fn();
    const s = createVoiceSession(h.deps, { serverTranscribe: true, onText });
    await s.start();
    s.stop();
    await vi.advanceTimersByTimeAsync(0);
    expect(s.getState().status).toBe("error");
    expect(s.getState().error).toBe("daily-limit");
    expect(s.getState().errorMessage).toMatch(/hoy/);
    expect(onText).not.toHaveBeenCalled();
    expect(allStopped(h.stream)).toBe(true);
  });

  it("si subir tira una excepción, termina en transcription-failed", async () => {
    const h = harness({ userAgent: UA_OPERA });
    h.upload.mockRejectedValueOnce(new Error("red"));
    const s = createVoiceSession(h.deps, { serverTranscribe: true });
    await s.start();
    s.stop();
    await vi.advanceTimersByTimeAsync(0);
    expect(s.getState().error).toBe("transcription-failed");
  });

  it("corta solo a los 2 minutos y transcribe", async () => {
    const h = harness({ userAgent: UA_OPERA });
    const s = createVoiceSession(h.deps, { serverTranscribe: true });
    await s.start();
    await vi.advanceTimersByTimeAsync(106_000);
    expect(s.getState().warning).toBe(true);
    expect(s.getState().status).toBe("escuchando");
    await vi.advanceTimersByTimeAsync(15_000);
    expect(h.upload).toHaveBeenCalledTimes(1);
    const [, durationMs] = h.upload.mock.calls[0] as unknown as [Blob, number];
    expect(durationMs).toBeLessThanOrEqual(120_000);
    expect(s.getState().status).toBe("listo");
    expect(allStopped(h.stream)).toBe(true);
  });
});

describe("errores al pedir el micrófono", () => {
  it.each([
    ["NotAllowedError", "permission-denied"],
    ["NotFoundError", "no-microphone"],
    ["NotReadableError", "mic-busy"],
  ])("%s -> %s", async (name, kind) => {
    const h = harness({
      getUserMedia: async () => {
        throw Object.assign(new Error("x"), { name });
      },
      userAgent: UA_OPERA,
    });
    const s = createVoiceSession(h.deps, { serverTranscribe: true });
    await s.start();
    expect(s.getState().status).toBe("error");
    expect(s.getState().error).toBe(kind);
    if (kind === "permission-denied") expect(s.getState().errorMessage).toMatch(/candado/i);
  });

  it("página no segura y sin mediaDevices", async () => {
    const a = createVoiceSession(harness({ isSecureContext: false }).deps, {
      serverTranscribe: true,
    });
    await a.start();
    expect(a.getState().error).toBe("insecure-context");
    const b = createVoiceSession(harness({ getUserMedia: null }).deps, { serverTranscribe: true });
    await b.start();
    expect(b.getState().error).toBe("unavailable");
  });

  it("se puede reintentar después de un error", async () => {
    const h = harness();
    h.getUserMedia.mockRejectedValueOnce(
      Object.assign(new Error("x"), { name: "NotAllowedError" }),
    );
    const s = createVoiceSession(h.deps, { serverTranscribe: false });
    await s.start();
    expect(s.getState().status).toBe("error");
    await s.start();
    expect(s.getState().status).toBe("escuchando");
    expect(s.getState().error).toBeNull();
    s.cancel();
  });
});

describe("cancelar y liberar", () => {
  it("Cancelar no deja texto, no sube y libera el micrófono", async () => {
    const h = harness({ userAgent: UA_OPERA });
    const onText = vi.fn();
    const s = createVoiceSession(h.deps, { serverTranscribe: true, onText });
    await s.start();
    s.cancel();
    expect(s.getState().status).toBe("idle");
    expect(s.getState().text).toBe("");
    expect(allStopped(h.stream)).toBe(true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.upload).not.toHaveBeenCalled();
    expect(onText).not.toHaveBeenCalled();
  });

  it("cancelar mientras se pide el permiso libera el stream cuando llega", async () => {
    const h = harness();
    const s = createVoiceSession(h.deps, { serverTranscribe: false });
    const p = s.start();
    s.cancel();
    await p;
    expect(s.getState().status).toBe("idle");
    expect(allStopped(h.stream)).toBe(true);
  });

  it("cancelar mientras sube descarta el resultado", async () => {
    const h = harness({ userAgent: UA_OPERA });
    const onText = vi.fn();
    const s = createVoiceSession(h.deps, { serverTranscribe: true, onText });
    await s.start();
    s.stop();
    s.cancel();
    await vi.advanceTimersByTimeAsync(0);
    expect(s.getState().status).toBe("idle");
    expect(onText).not.toHaveBeenCalled();
  });

  it("dispose libera todo", async () => {
    const h = harness();
    const s = createVoiceSession(h.deps, { serverTranscribe: true });
    await s.start();
    s.dispose();
    expect(allStopped(h.stream)).toBe(true);
    expect(FakeRecognition.last?.aborted).toBe(true);
  });
});
