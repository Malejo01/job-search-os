import type { PromptRef } from "@job-search-os/prompts";
import { z } from "zod";
import type { LlmClient } from "../llm/types";
import type { VoiceReservation } from "./reserve";

/** Tarea registrada en `model_routing` y en `llm_calls` (snake_case). Principal Gemini y sin respaldo. */
export const TRANSCRIBE_TASK = "transcribe_audio";
export const TRANSCRIBE_PROMPT: PromptRef = "transcribe_audio@v1";

/** Salida del modelo: solo el texto. */
export const TranscriptionOutputSchema = z.object({ text: z.string().max(20_000) });

export type TranscribeFailure =
  /** Cupo de 20 minutos del día. */
  | "daily_limit"
  /** Tope de gasto global o de la persona. */
  | "tope_global"
  | "tope_user"
  /** El modelo no respondió o la salida no sirvió: la persona puede escribir. */
  | "modelo";

export type TranscribeOutcome =
  { ok: true; text: string; seconds: number } | { ok: false; code: TranscribeFailure };

export type TranscribeDeps = {
  llm: LlmClient;
  /** Reserva de cupo y gasto antes de llamar (`reserveVoice`). */
  reserve: (input: {
    userId: string;
    seconds: number;
    requestId: string;
  }) => Promise<VoiceReservation>;
  /** Suelta la reserva (`releaseVoiceReservation`). Nunca lanza. */
  release: (reservationId: string) => Promise<unknown>;
  newRequestId?: () => string;
};

/**
 * Transcribe una grabación. Orden: reserva (cupo diario y topes de USD) → modelo → soltar la reserva, siempre.
 * El audio solo viaja al proveedor, en memoria: no se escribe en disco ni en la base ni en ningún log, y esta
 * función tampoco loguea el texto. A `llm_calls` lo deja el cliente LLM: duración (etiqueta `voice:<s>:<id>`),
 * costo y modelo, nunca el texto. Si el modelo falla, la fila queda con `ok = false` y esos segundos no gastan
 * cupo. El texto es una propuesta: nada lo dispara solo, la persona lo revisa antes de enviar (el modelo evalúa,
 * el código decide).
 *
 * `seconds` es la duración ya validada por `validateVoiceUpload` (declarada, redondeada y acotada).
 */
export async function transcribeAudio(
  deps: TranscribeDeps,
  input: {
    userId: string;
    audio: Uint8Array;
    mime: string;
    seconds: number;
    signal?: AbortSignal;
  },
): Promise<TranscribeOutcome> {
  const requestId = (deps.newRequestId ?? (() => globalThis.crypto.randomUUID()))();
  const reservation = await deps.reserve({
    userId: input.userId,
    seconds: input.seconds,
    requestId,
  });
  if (!reservation.ok) {
    return {
      ok: false,
      code:
        reservation.reason === "daily_limit"
          ? "daily_limit"
          : reservation.reason === "user"
            ? "tope_user"
            : "tope_global",
    };
  }
  try {
    const res = await deps.llm.generateStructured(
      TRANSCRIBE_TASK,
      TranscriptionOutputSchema,
      // Variable informativa: la usa el fake de demo; el prompt real no la lleva
      { duration_seconds: input.seconds },
      {
        userId: input.userId,
        promptVersion: TRANSCRIBE_PROMPT,
        label: reservation.label,
        // `images` es el canal de archivos del cliente LLM: lleva también audio
        images: [{ mediaType: input.mime, data: input.audio }],
        ...(input.signal ? { signal: input.signal } : {}),
      },
    );
    if (!res.ok) return { ok: false, code: "modelo" };
    return { ok: true, text: res.value.object.text.trim(), seconds: input.seconds };
  } finally {
    await deps.release(reservation.reservationId);
  }
}
