import {
  createLogger,
  originAllowed,
  releaseVoiceReservation,
  reserveVoice,
  transcribeAudio,
  type TranscribeFailure,
} from "@job-search-os/adapters";
import { createDb, requireDatabaseUrl } from "@job-search-os/db";
import {
  VOICE_MAX_BYTES,
  validateVoiceUpload,
  voiceDailySeconds,
  type VoiceUploadReject,
} from "@job-search-os/pipeline";
import { serviceLlm } from "@/lib/llm-service";
import { sessionUserId } from "@/lib/session";
import { siteUrl } from "@/lib/site-url";
import { needsTermsAcceptance } from "@/lib/terms-status";
import { readBytesLimited, voiceServerAllowedFor } from "@/lib/voice/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Transcripción de voz en el servidor (R25-03, ADR de «Voz híbrida»). Para los navegadores sin dictado propio
 * (Opera, Brave, Firefox): el cliente graba con `MediaRecorder` y manda el audio acá; devuelve el texto.
 *
 * Orden: sesión (401) → interruptor `VOICE_SERVER_TRANSCRIBE` (403 `off`) → origen y términos → cuerpo con
 * tope de bytes (413) → un solo archivo de audio permitido con su duración (415 y 400) → cupo y gasto
 * (429) → modelo (503). El audio vive solo en memoria durante el pedido: no se escribe en disco, en la base ni
 * en ningún log; a `llm_calls` va la duración y el costo, nunca el texto. Nunca se devuelve el texto de una
 * excepción ni se loguea lo transcripto.
 *
 * Contrato: `POST multipart/form-data` con `audio` (un archivo) y `durationMs`. Respuestas: 200 `{ text }`;
 * 401 `{ error: "unauthorized" }`; 403 `{ error: "off" }`; 400, 413 y 415 `{ error, message }`; 429
 * `{ error: "daily_limit", message }`; 503 `{ error: "model", message }`.
 */

type ErrorCode =
  | "unauthorized"
  | "off"
  | "bad_origin"
  | "not_ready"
  | "bad_request"
  | "empty"
  | "too_large"
  | "unsupported_type"
  | "duration"
  | "too_long"
  | "daily_limit"
  | "model";

const MESSAGES: Record<ErrorCode, string> = {
  unauthorized: "Iniciá sesión para seguir.",
  off: "La transcripción de voz no está disponible. Escribí tu respuesta.",
  bad_origin: "Pedido no permitido.",
  not_ready: "Antes completá los términos.",
  bad_request: "No pudimos leer la grabación. Probá de nuevo o escribí tu respuesta.",
  empty: "La grabación está vacía. Probá de nuevo.",
  too_large: "La grabación es demasiado grande. Probá con una más corta.",
  unsupported_type: "Ese formato de audio no está permitido. Escribí tu respuesta.",
  duration: "La grabación es muy corta o su duración no es válida. Probá de nuevo.",
  too_long: "La grabación pasa los 2 minutos. Grabá en partes más cortas.",
  daily_limit: "Llegaste al tope de voz de hoy. Podés seguir escribiendo.",
  model: "Ahora no pudimos transcribir. Escribí tu respuesta o probá de nuevo en un rato.",
};

const STATUS: Record<ErrorCode, number> = {
  unauthorized: 401,
  off: 403,
  bad_origin: 403,
  not_ready: 403,
  bad_request: 400,
  empty: 400,
  too_large: 413,
  unsupported_type: 415,
  duration: 400,
  too_long: 400,
  daily_limit: 429,
  model: 503,
};

const NO_STORE = { "Cache-Control": "no-store" };

function fail(code: ErrorCode): Response {
  return Response.json(
    { ok: false, error: code, message: MESSAGES[code] },
    { status: STATUS[code], headers: NO_STORE },
  );
}

const UPLOAD_CODES: Record<VoiceUploadReject, ErrorCode> = {
  empty: "empty",
  too_large: "too_large",
  type: "unsupported_type",
  signature: "unsupported_type",
  duration: "duration",
  too_long: "too_long",
  too_dense: "duration",
};

const TRANSCRIBE_CODES: Record<TranscribeFailure, ErrorCode> = {
  daily_limit: "daily_limit",
  // Tope de gasto de la persona: para ella es el mismo tope del día
  tope_user: "daily_limit",
  // Tope global: el servicio está saturado, no es culpa de la persona; puede escribir
  tope_global: "model",
  modelo: "model",
};

/** Lo que pesa el multipart además del archivo: el nombre de las partes, los límites y `durationMs`. */
const MULTIPART_OVERHEAD_BYTES = 16 * 1024;

export async function POST(request: Request): Promise<Response> {
  // 1) sesión → 2) interruptor (apagado = 403 `off`, sin tocar el modelo)
  const userId = await sessionUserId();
  if (!userId) return fail("unauthorized");
  if (!(await voiceServerAllowedFor(userId))) return fail("off");

  const allowed = [new URL(request.url).origin, siteUrl()];
  if (process.env.AUTH_URL) allowed.push(process.env.AUTH_URL);
  if (!originAllowed(request.headers.get("origin"), allowed)) return fail("bad_origin");
  if (await needsTermsAcceptance(userId)) return fail("not_ready");

  const logger = createLogger({ user_id: userId, trigger: "transcribe" });

  // 3) cuerpo con tope de bytes, en memoria
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data\s*;/i.test(contentType)) return fail("bad_request");
  const body = await readBytesLimited(request, VOICE_MAX_BYTES + MULTIPART_OVERHEAD_BYTES);
  if (!body.ok) return fail("too_large");

  // 4) un solo archivo `audio` y `durationMs`
  let form: FormData;
  try {
    form = await new Response(body.bytes as BodyInit, {
      headers: { "content-type": contentType },
    }).formData();
  } catch {
    return fail("bad_request");
  }
  const files = [...form.values()].filter((v): v is File => typeof v !== "string");
  const audioParts = form.getAll("audio");
  const file = audioParts[0];
  if (files.length !== 1 || audioParts.length !== 1 || typeof file === "string" || !file) {
    return fail("bad_request");
  }
  const durationRaw = form.get("durationMs");
  if (typeof durationRaw !== "string" || !/^\d{1,9}$/.test(durationRaw.trim())) {
    return fail("duration");
  }
  const audio = new Uint8Array(await file.arrayBuffer());
  const checked = validateVoiceUpload({
    type: file.type,
    bytes: audio,
    durationMs: Number(durationRaw),
  });
  if (!checked.ok) return fail(UPLOAD_CODES[checked.reason]);

  // 5) cupo y gasto → 6) modelo
  let conn = null as ReturnType<typeof createDb> | null;
  try {
    conn = createDb(requireDatabaseUrl({ purpose: "service" }), { max: 1 });
    const db = conn.db;
    const dailySeconds = voiceDailySeconds(process.env);
    const out = await transcribeAudio(
      {
        llm: serviceLlm(db, logger),
        reserve: (input) => reserveVoice(db, { ...input, dailySeconds }),
        release: (id) => releaseVoiceReservation(db, id),
      },
      {
        userId,
        audio,
        mime: checked.mime,
        seconds: checked.seconds,
        signal: request.signal,
      },
    );
    if (!out.ok) {
      logger.warn({ outcome: out.code, seconds: checked.seconds }, "voz: sin transcribir");
      return fail(TRANSCRIBE_CODES[out.code]);
    }
    // Solo duración y tamaño: nunca el texto ni el audio
    logger.info({ seconds: out.seconds, bytes: audio.length, chars: out.text.length }, "voz: ok");
    return Response.json({ text: out.text }, { headers: NO_STORE });
  } catch {
    // Nunca el mensaje de la excepción: puede citar datos de la persona
    logger.error({}, "voz: falló la transcripción");
    return fail("model");
  } finally {
    await conn?.close();
  }
}
