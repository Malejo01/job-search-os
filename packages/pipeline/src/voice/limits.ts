/**
 * Límites de la transcripción de voz en el servidor (R25-03). Puro: sin I/O ni hora implícita (ADR-001).
 * Lo usan la ruta `POST /api/transcribe` (validación de entrada) y `packages/adapters/src/voice` (cupo).
 *
 * - Una grabación: 2 MB, 120 s declarados (el cliente corta a los 2 minutos y avisa a los 105 s).
 * - Cupo diario: 20 minutos por persona (`VOICE_DAILY_MINUTES`), ventana móvil de 24 h, además del tope
 *   global de gasto que decide `reserveLlmSpend`.
 * - El servidor no decodifica el audio: la duración es la que declara el cliente. Para que declarar menos
 *   segundos no sirva para colar más audio por el mismo cupo, se controlan los bytes por segundo.
 */
import { readCap } from "../cap-env";

export const VOICE_MAX_BYTES = 2 * 1024 * 1024;
export const VOICE_MAX_SECONDS = 120;
/** A este segundo el cliente avisa que se corta pronto. */
export const VOICE_WARN_SECONDS = 105;
/** Tolerancia de reloj entre el cliente y el servidor sobre el tope de duración declarada. */
export const VOICE_DURATION_TOLERANCE_MS = 1_500;
/** Menos que esto no es una grabación (un toque sin querer). */
export const VOICE_MIN_MS = 300;
export const VOICE_DEFAULT_DAILY_MINUTES = 20;
export const VOICE_DEFAULT_DAILY_SECONDS = VOICE_DEFAULT_DAILY_MINUTES * 60;
/**
 * Bytes por segundo de audio como máximo. Opus a 128 kbps son 16 kB/s y AAC de Safari, parecido: 32 kB/s deja
 * el doble de margen y alcanza para que 2 MB declarados en pocos segundos no pasen.
 */
export const VOICE_MAX_BYTES_PER_SECOND = 32_000;

export const VOICE_AUDIO_TYPES = ["audio/webm", "audio/ogg", "audio/mp4"] as const;
export type VoiceAudioType = (typeof VOICE_AUDIO_TYPES)[number];

/** Cupo diario en segundos desde `VOICE_DAILY_MINUTES` (entero de 1 a 1.440; inválido = 20 minutos). */
export function voiceDailySeconds(env: Record<string, string | undefined>): number {
  return (
    readCap(env, "VOICE_DAILY_MINUTES", VOICE_DEFAULT_DAILY_MINUTES, { kind: "int", max: 1440 }) *
    60
  );
}

/** `audio/webm;codecs=opus` → `audio/webm`. `null` si no es uno de los tres tipos permitidos. */
export function normalizeAudioType(raw: string | null | undefined): VoiceAudioType | null {
  const base = (raw ?? "").split(";")[0]!.trim().toLowerCase();
  return (VOICE_AUDIO_TYPES as readonly string[]).includes(base) ? (base as VoiceAudioType) : null;
}

/** El contenedor que dicen los primeros bytes: EBML (webm), «OggS» (ogg) o «ftyp» en el byte 4 (mp4). */
function sniffAudioType(b: Uint8Array): VoiceAudioType | null {
  if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) {
    return "audio/webm";
  }
  if (b.length >= 4 && b[0] === 0x4f && b[1] === 0x67 && b[2] === 0x67 && b[3] === 0x53) {
    return "audio/ogg";
  }
  if (b.length >= 8 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) {
    return "audio/mp4";
  }
  return null;
}

export type VoiceUploadReject =
  "empty" | "too_large" | "type" | "signature" | "duration" | "too_long" | "too_dense";

export type VoiceUploadCheck =
  { ok: true; mime: VoiceAudioType; seconds: number } | { ok: false; reason: VoiceUploadReject };

/**
 * Valida una grabación antes de gastar nada. `seconds` es la duración declarada redondeada hacia arriba y
 * acotada a 120: es lo que se reserva y se cuenta contra el cupo del día.
 */
export function validateVoiceUpload(input: {
  type: string;
  bytes: Uint8Array;
  durationMs: number;
}): VoiceUploadCheck {
  const { bytes, durationMs } = input;
  if (bytes.length === 0) return { ok: false, reason: "empty" };
  if (bytes.length > VOICE_MAX_BYTES) return { ok: false, reason: "too_large" };
  const mime = normalizeAudioType(input.type);
  if (!mime) return { ok: false, reason: "type" };
  if (sniffAudioType(bytes) !== mime) return { ok: false, reason: "signature" };
  if (!Number.isFinite(durationMs) || durationMs < VOICE_MIN_MS) {
    return { ok: false, reason: "duration" };
  }
  if (durationMs > VOICE_MAX_SECONDS * 1000 + VOICE_DURATION_TOLERANCE_MS) {
    return { ok: false, reason: "too_long" };
  }
  const seconds = Math.min(VOICE_MAX_SECONDS, Math.ceil(durationMs / 1000));
  if (bytes.length / seconds > VOICE_MAX_BYTES_PER_SECOND) {
    return { ok: false, reason: "too_dense" };
  }
  return { ok: true, mime, seconds };
}

export type VoiceQuotaDecision =
  { ok: true; remainingSeconds: number } | { ok: false; remainingSeconds: number };

/**
 * Cupo diario: lo usado (grabaciones transcriptas en 24 h) más lo reservado (pedidos en vuelo) más lo que se
 * pide no puede pasar de `dailySeconds`. `remainingSeconds`: lo que queda después de este pedido si entra; lo
 * que quedaba antes si no. Un número inválido frena (falla cerrado).
 */
export function voiceQuotaDecision(input: {
  usedSeconds: number;
  reservedSeconds: number;
  requestSeconds: number;
  dailySeconds: number;
}): VoiceQuotaDecision {
  const { usedSeconds, reservedSeconds, requestSeconds, dailySeconds } = input;
  const valid =
    [usedSeconds, reservedSeconds, dailySeconds].every((n) => Number.isFinite(n) && n >= 0) &&
    Number.isFinite(requestSeconds) &&
    requestSeconds > 0;
  if (!valid) return { ok: false, remainingSeconds: 0 };
  const left = Math.max(0, dailySeconds - usedSeconds - reservedSeconds);
  return requestSeconds <= left
    ? { ok: true, remainingSeconds: left - requestSeconds }
    : { ok: false, remainingSeconds: left };
}

/**
 * Reserva de USD por segundo de audio, antes de llamar. Con `gemini-3.5-flash` (1,5 USD de entrada y 9 de
 * salida por millón de tokens, `model_routing`) un minuto de audio son unos 2.000 tokens de entrada y no más
 * de unos 400 de salida: menos de 0,01 USD. Se reserva el triple como máximo, con un piso para las cortas.
 * Atado al seed por `packages/adapters/src/voice/voice.test.ts`.
 */
export const VOICE_RESERVE_USD_PER_SECOND = 0.0003;
export const VOICE_RESERVE_MIN_USD = 0.005;

export function voiceReserveUsd(seconds: number): number {
  const s = Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, VOICE_MAX_SECONDS) : 0;
  return Math.max(VOICE_RESERVE_MIN_USD, Math.round(s * VOICE_RESERVE_USD_PER_SECOND * 1e6) / 1e6);
}

/**
 * Etiqueta de `llm_calls` de un pedido: `voice:<segundos>:<id>`. La lleva la reserva viva y la fila que el
 * cliente LLM deja de esa transcripción, así los segundos se cuentan desde `llm_calls` sin guardar el texto ni
 * el audio. Una etiqueta se cuenta una sola vez.
 */
export const VOICE_LABEL_PREFIX = "voice:";

export function voiceLabel(seconds: number, requestId: string): string {
  return `${VOICE_LABEL_PREFIX}${Math.trunc(seconds)}:${requestId}`;
}

export function parseVoiceLabel(
  label: string | null | undefined,
): { seconds: number; requestId: string } | null {
  const m = /^voice:(\d{1,4}):([A-Za-z0-9_-]{1,64})$/.exec(label ?? "");
  return m ? { seconds: Number(m[1]), requestId: m[2]! } : null;
}
