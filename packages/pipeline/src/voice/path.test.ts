import { describe, expect, it } from "vitest";
import {
  VOICE_CLIENT_MAX_MS,
  VOICE_CLIENT_WARN_MS,
  VOICE_NO_RESULT_TIMEOUT_MS,
  chooseVoicePath,
  detectVoiceBrowser,
  pickRecordingMime,
  recordingTimeState,
  shouldFallBackToRecording,
  voiceErrorKindFromName,
  voiceErrorMessage,
} from "./path";

const UA = {
  chrome:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  chromeAndroid:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
  chromeIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.0.0 Mobile/15E148 Safari/604.1",
  edge: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
  edgeAndroid:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36 EdgA/131.0.0.0",
  safari:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  safariIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  opera:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 OPR/115.0.0.0",
  operaGx:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 OPR/115.0.0.0 (Edition GX)",
  operaAndroid:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36 OPR/85.0.0.0",
  firefox: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0",
  firefoxAndroid: "Mozilla/5.0 (Android 14; Mobile; rv:133.0) Gecko/133.0 Firefox/133.0",
  firefoxIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/133.0 Mobile/15E148 Safari/605.1.15",
  samsung:
    "Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36",
};

describe("detectVoiceBrowser", () => {
  it.each([
    ["chrome", "chrome"],
    ["chromeAndroid", "chrome"],
    ["chromeIos", "chrome"],
    ["edge", "edge"],
    ["edgeAndroid", "edge"],
    ["safari", "safari"],
    ["safariIos", "safari"],
    ["opera", "opera"],
    ["operaGx", "opera-gx"],
    ["operaAndroid", "opera"],
    ["firefox", "firefox"],
    ["firefoxAndroid", "firefox"],
    ["firefoxIos", "firefox"],
    ["samsung", "samsung"],
  ] as const)("%s -> %s", (key, expected) => {
    expect(detectVoiceBrowser(UA[key])).toBe(expected);
  });

  it("Brave se delata solo con la señal de navigator.brave", () => {
    expect(detectVoiceBrowser(UA.chrome)).toBe("chrome");
    expect(detectVoiceBrowser(UA.chrome, { isBrave: true })).toBe("brave");
  });

  it("un UA vacío o raro es other", () => {
    expect(detectVoiceBrowser("")).toBe("other");
    expect(detectVoiceBrowser("curl/8.0")).toBe("other");
  });
});

describe("chooseVoicePath", () => {
  it("Chrome, Edge y Safari con reconocimiento usan el del navegador", () => {
    for (const k of [
      "chrome",
      "chromeAndroid",
      "edge",
      "safari",
      "safariIos",
      "samsung",
    ] as const) {
      expect(chooseVoicePath({ userAgent: UA[k], hasSpeechRecognition: true })).toBe("browser");
    }
  });

  it("Opera, Opera GX, Brave y Firefox graban aunque exponga webkitSpeechRecognition", () => {
    for (const k of [
      "opera",
      "operaGx",
      "operaAndroid",
      "firefox",
      "firefoxAndroid",
      "firefoxIos",
    ] as const) {
      expect(chooseVoicePath({ userAgent: UA[k], hasSpeechRecognition: true })).toBe("record");
    }
    expect(
      chooseVoicePath({ userAgent: UA.chrome, hasSpeechRecognition: true, isBrave: true }),
    ).toBe("record");
  });

  it("sin reconocimiento graba, sea cual sea el navegador", () => {
    for (const k of Object.keys(UA) as (keyof typeof UA)[]) {
      expect(chooseVoicePath({ userAgent: UA[k], hasSpeechRecognition: false })).toBe("record");
    }
  });

  it("un navegador desconocido con reconocimiento usa el suyo", () => {
    expect(chooseVoicePath({ userAgent: "algo/1.0", hasSpeechRecognition: true })).toBe("browser");
  });
});

describe("shouldFallBackToRecording", () => {
  it.each(["network", "service-not-allowed", "not-allowed"])(
    "el error %s obliga a grabar",
    (code) => {
      expect(shouldFallBackToRecording({ kind: "error", code })).toBe(true);
    },
  );

  it("no-speech, aborted y otros no obligan", () => {
    for (const code of ["no-speech", "aborted", "audio-capture", "otro", undefined]) {
      expect(shouldFallBackToRecording({ kind: "error", code })).toBe(false);
    }
  });

  it("4 s sin resultado con señal obligan; sin señal o antes de tiempo no", () => {
    expect(VOICE_NO_RESULT_TIMEOUT_MS).toBe(4000);
    expect(shouldFallBackToRecording({ kind: "no-result", elapsedMs: 4000, hasSignal: true })).toBe(
      true,
    );
    expect(shouldFallBackToRecording({ kind: "no-result", elapsedMs: 9000, hasSignal: true })).toBe(
      true,
    );
    expect(shouldFallBackToRecording({ kind: "no-result", elapsedMs: 3999, hasSignal: true })).toBe(
      false,
    );
    expect(
      shouldFallBackToRecording({ kind: "no-result", elapsedMs: 9000, hasSignal: false }),
    ).toBe(false);
  });
});

describe("pickRecordingMime", () => {
  it("prefiere webm/opus, después ogg, después mp4", () => {
    expect(pickRecordingMime(() => true)).toBe("audio/webm;codecs=opus");
    expect(pickRecordingMime((m) => m === "audio/ogg" || m === "audio/mp4")).toBe("audio/ogg");
    expect(pickRecordingMime((m) => m === "audio/mp4")).toBe("audio/mp4");
  });
  it("sin ninguno devuelve null; si isTypeSupported tira, lo trata como no soportado", () => {
    expect(pickRecordingMime(() => false)).toBeNull();
    expect(
      pickRecordingMime((m) => {
        if (m.startsWith("audio/webm")) throw new Error("x");
        return m === "audio/ogg";
      }),
    ).toBe("audio/ogg");
  });
});

describe("recordingTimeState", () => {
  it("avisa a 1:45 y corta a 2:00", () => {
    expect(VOICE_CLIENT_MAX_MS).toBe(120_000);
    expect(VOICE_CLIENT_WARN_MS).toBe(105_000);
    expect(recordingTimeState(0)).toBe("ok");
    expect(recordingTimeState(104_999)).toBe("ok");
    expect(recordingTimeState(105_000)).toBe("warn");
    expect(recordingTimeState(119_999)).toBe("warn");
    expect(recordingTimeState(120_000)).toBe("cut");
  });
});

describe("voiceErrorKindFromName", () => {
  it("mapea los DOMException de getUserMedia", () => {
    expect(voiceErrorKindFromName("NotAllowedError")).toBe("permission-denied");
    expect(voiceErrorKindFromName("PermissionDeniedError")).toBe("permission-denied");
    expect(voiceErrorKindFromName("NotFoundError")).toBe("no-microphone");
    expect(voiceErrorKindFromName("OverconstrainedError")).toBe("no-microphone");
    expect(voiceErrorKindFromName("NotReadableError")).toBe("mic-busy");
    expect(voiceErrorKindFromName("SecurityError")).toBe("insecure-context");
    expect(voiceErrorKindFromName("Raro")).toBe("unavailable");
    expect(voiceErrorKindFromName(undefined)).toBe("unavailable");
  });
});

describe("voiceErrorMessage", () => {
  it("permiso denegado explica cómo darlo según el navegador", () => {
    expect(voiceErrorMessage("permission-denied", UA.opera)).toMatch(/candado/i);
    expect(voiceErrorMessage("permission-denied", UA.operaGx)).toMatch(/candado/i);
    expect(voiceErrorMessage("permission-denied", UA.firefox)).toMatch(/Firefox|candado/);
    expect(voiceErrorMessage("permission-denied", UA.safari)).toMatch(/Safari/);
    expect(voiceErrorMessage("permission-denied", UA.chrome, { isBrave: true })).toMatch(
      /Brave|escudo|candado/i,
    );
    expect(voiceErrorMessage("permission-denied", UA.chrome)).toMatch(/candado|ajustes/i);
    expect(voiceErrorMessage("permission-denied", "")).toMatch(/micr[óo]fono/i);
  });

  it("cada tipo tiene un texto propio, en voseo, que no repite a los otros", () => {
    const kinds = [
      "permission-denied",
      "no-microphone",
      "mic-busy",
      "insecure-context",
      "daily-limit",
      "server-off",
      "transcription-failed",
      "unavailable",
    ] as const;
    const texts = kinds.map((k) => voiceErrorMessage(k, UA.chrome));
    expect(new Set(texts).size).toBe(kinds.length);
    for (const t of texts) expect(t.length).toBeGreaterThan(20);
  });

  it("sin micrófono, página no segura y tope del día dicen lo que pasó", () => {
    expect(voiceErrorMessage("no-microphone", UA.chrome)).toMatch(/micr[óo]fono/i);
    expect(voiceErrorMessage("insecure-context", UA.chrome)).toMatch(/https|segur/i);
    expect(voiceErrorMessage("daily-limit", UA.chrome)).toMatch(/hoy|d[íi]a/i);
    expect(voiceErrorMessage("server-off", UA.firefox)).toMatch(/escrib/i);
  });
});
