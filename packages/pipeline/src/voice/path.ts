/**
 * Voz (R25-01): elige el camino de dictado y arma los mensajes de error. Puro: sin DOM, sin I/O, sin hora
 * implícita (ADR-001). El hook de cliente (`apps/web/lib/voice/use-voice-input.ts`) le pasa el user agent y lo
 * que detectó del navegador.
 *
 * Dos caminos:
 * - `browser`: Web Speech del navegador (Chrome, Edge, Safari): gratis, con texto en vivo.
 * - `record`: grabar con `MediaRecorder` y transcribir en el servidor (Opera, Opera GX, Brave, Firefox).
 *   Opera y Brave exponen `webkitSpeechRecognition` pero sin el servicio de Google detrás: falla en silencio.
 */

export type VoicePath = "browser" | "record";

export type VoiceBrowser =
  "chrome" | "edge" | "safari" | "opera" | "opera-gx" | "brave" | "firefox" | "samsung" | "other";

/** Navegadores que exponen (o no) Web Speech pero no la hacen andar: siempre graban. */
const RECORD_BROWSERS: ReadonlySet<VoiceBrowser> = new Set([
  "opera",
  "opera-gx",
  "brave",
  "firefox",
]);

export type VoiceBrowserHints = {
  /** `navigator.brave` existe: Brave no se delata en el user agent. */
  isBrave?: boolean;
};

export function detectVoiceBrowser(userAgent: string, hints: VoiceBrowserHints = {}): VoiceBrowser {
  const ua = userAgent ?? "";
  if (/\bEdg(?:e|A|iOS)?\//.test(ua)) return "edge";
  if (/\bOPR\//.test(ua) || /\bOpera\b/.test(ua) || /\bOPT\//.test(ua)) {
    return /\bGX\b|Edition GX/i.test(ua) ? "opera-gx" : "opera";
  }
  if (/\bFirefox\/|\bFxiOS\//.test(ua)) return "firefox";
  if (/\bSamsungBrowser\//.test(ua)) return "samsung";
  if (hints.isBrave && /\bChrome\//.test(ua)) return "brave";
  if (/\bChrome\/|\bCriOS\//.test(ua)) return "chrome";
  if (/\bSafari\//.test(ua) && /\bVersion\//.test(ua)) return "safari";
  return "other";
}

export type VoicePathInput = VoiceBrowserHints & {
  userAgent: string;
  /** El navegador expone `SpeechRecognition` o `webkitSpeechRecognition`. */
  hasSpeechRecognition: boolean;
};

export function chooseVoicePath(input: VoicePathInput): VoicePath {
  if (!input.hasSpeechRecognition) return "record";
  const browser = detectVoiceBrowser(input.userAgent, { isBrave: input.isBrave });
  return RECORD_BROWSERS.has(browser) ? "record" : "browser";
}

/** Sin ningún resultado de reconocimiento durante este tiempo, habiendo señal de audio, se pasa a grabar. */
export const VOICE_NO_RESULT_TIMEOUT_MS = 4000;

const FALLBACK_ERROR_CODES: ReadonlySet<string> = new Set([
  "network",
  "service-not-allowed",
  "not-allowed",
]);

export type VoiceFallbackEvent =
  | { kind: "error"; code: string | undefined }
  | { kind: "no-result"; elapsedMs: number; hasSignal: boolean };

/** ¿Hay que pasar del dictado del navegador a la grabación? (lo hablado no se pierde: ya se viene grabando). */
export function shouldFallBackToRecording(event: VoiceFallbackEvent): boolean {
  if (event.kind === "error")
    return event.code !== undefined && FALLBACK_ERROR_CODES.has(event.code);
  return event.hasSignal && event.elapsedMs >= VOICE_NO_RESULT_TIMEOUT_MS;
}

const MIME_PREFERENCE = ["audio/webm;codecs=opus", "audio/ogg", "audio/mp4"] as const;

/** El primer formato que soporta el navegador, o `null` (entonces se graba con el formato por defecto). */
export function pickRecordingMime(isTypeSupported: (mime: string) => boolean): string | null {
  for (const mime of MIME_PREFERENCE) {
    try {
      if (isTypeSupported(mime)) return mime;
    } catch {
      /* este formato no se puede consultar: se prueba el siguiente */
    }
  }
  return null;
}

/** Corte por grabación (2 min) y aviso (1:45). Coinciden con `VOICE_MAX_SECONDS` del servidor. */
export const VOICE_CLIENT_MAX_MS = 120_000;
export const VOICE_CLIENT_WARN_MS = 105_000;

export function recordingTimeState(elapsedMs: number): "ok" | "warn" | "cut" {
  if (elapsedMs >= VOICE_CLIENT_MAX_MS) return "cut";
  if (elapsedMs >= VOICE_CLIENT_WARN_MS) return "warn";
  return "ok";
}

export type VoiceErrorKind =
  | "permission-denied"
  | "no-microphone"
  | "mic-busy"
  | "insecure-context"
  | "daily-limit"
  | "server-off"
  | "transcription-failed"
  | "unavailable";

/** Del `name` de un `DOMException` de `getUserMedia` al tipo de error. */
export function voiceErrorKindFromName(name: string | undefined): VoiceErrorKind {
  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return "permission-denied";
    case "NotFoundError":
    case "DevicesNotFoundError":
    case "OverconstrainedError":
      return "no-microphone";
    case "NotReadableError":
    case "TrackStartError":
    case "AbortError":
      return "mic-busy";
    case "SecurityError":
      return "insecure-context";
    default:
      return "unavailable";
  }
}

function permissionHelp(browser: VoiceBrowser): string {
  switch (browser) {
    case "opera":
    case "opera-gx":
      return "Tocá el ícono del candado a la izquierda de la barra de direcciones, elegí «Configuración del sitio», poné el micrófono en «Permitir» y recargá la página.";
    case "brave":
      return "Tocá el candado (o el ícono del escudo) a la izquierda de la barra de direcciones, poné el micrófono en «Permitir» y recargá la página.";
    case "firefox":
      return "En Firefox, tocá el candado a la izquierda de la barra de direcciones, sacá el bloqueo del micrófono en «Permisos» y recargá la página.";
    case "safari":
      return "En Safari, abrí «Safari > Configuración para este sitio web», poné el micrófono en «Preguntar» o «Permitir» y recargá la página.";
    case "edge":
      return "Tocá el candado a la izquierda de la barra de direcciones, poné el micrófono en «Permitir» y recargá la página.";
    case "samsung":
      return "Tocá el candado a la izquierda de la barra de direcciones, habilitá el micrófono en «Permisos» y recargá la página.";
    case "chrome":
      return "Tocá el candado (o el ícono de ajustes) a la izquierda de la barra de direcciones, poné el micrófono en «Permitir» y recargá la página.";
    default:
      return "Habilitá el micrófono para este sitio desde el candado de la barra de direcciones y recargá la página.";
  }
}

/** Texto para mostrar, en voseo, según el tipo de error y el navegador. */
export function voiceErrorMessage(
  kind: VoiceErrorKind,
  userAgent: string,
  hints: VoiceBrowserHints = {},
): string {
  switch (kind) {
    case "permission-denied":
      return `El navegador no nos dejó usar el micrófono. ${permissionHelp(detectVoiceBrowser(userAgent, hints))}`;
    case "no-microphone":
      return "No encontramos un micrófono conectado. Conectá uno, revisá que esté habilitado en el sistema y probá de nuevo, o escribí la respuesta.";
    case "mic-busy":
      return "El micrófono lo está usando otra aplicación o pestaña. Cerrala y probá de nuevo, o escribí la respuesta.";
    case "insecure-context":
      return "El micrófono solo funciona en páginas seguras (https). Abrí la app desde su dirección con https, o escribí la respuesta.";
    case "daily-limit":
      return "Por hoy llegaste al tope de voz: podés seguir escribiendo";
    case "server-off":
      return "Dictar por voz todavía no está disponible en este navegador. Probá con Chrome, Edge o Safari, o escribí la respuesta.";
    case "transcription-failed":
      return "No pudimos transcribir el audio ahora. Escribí la respuesta o probá de nuevo en un rato.";
    case "unavailable":
      return "El dictado no está disponible en este momento. Podés escribir la respuesta.";
  }
}
