import { schema as s, type Db } from "@job-search-os/db";
import {
  parseVoiceLabel,
  voiceDailySeconds,
  voiceLabel,
  voiceQuotaDecision,
  voiceReserveUsd,
  VOICE_LABEL_PREFIX,
} from "@job-search-os/pipeline";
import { and, eq, gte, like } from "drizzle-orm";
import { LLM_RESERVE_TASK } from "../llm/spend";
import {
  LLM_RESERVE_TTL_MS,
  releaseLlmSpend,
  reserveSpendWithGate,
  type SpendReserveInput,
} from "../llm/spend-reserve";

/**
 * Reserva de cupo y de gasto de la transcripción de voz (R25-03). Mismo esquema que la versión del CV adaptada
 * (`cv-tailor/reserve.ts`) y el simulador de entrevistas: una transacción corta, bajo el lock global del gasto,
 * mide lo gastado más lo reservado y, si entra en los topes, anota una fila de reserva; la llamada al modelo va
 * afuera; la reserva se suelta en un `finally` y, si el proceso muere, deja de contar cuando vence (5 min).
 *
 * Dos topes, los dos bajo el mismo lock:
 * - USD (global y por persona): `reserveSpendWithGate`, con `voiceReserveUsd(segundos)` de estimado.
 * - Cupo de audio: 20 minutos por persona en una ventana móvil de 24 h (`VOICE_DAILY_MINUTES`).
 *
 * Los segundos salen de la etiqueta `voice:<segundos>:<id>`: la lleva la reserva viva y la lleva la fila que el
 * cliente LLM deja en `llm_calls` de esa transcripción (solo las que respondieron: una llamada fallida libera
 * su cupo). Cada etiqueta se cuenta una sola vez, así el instante en que conviven la reserva y la fila real no
 * cuenta doble. Ni el audio ni el texto se guardan: a `llm_calls` va la duración (en la etiqueta) y el costo.
 */
export const VOICE_TASK = "transcribe_audio";

const DAY_MS = 24 * 60 * 60 * 1000;

export type VoiceCaps = Pick<
  SpendReserveInput,
  "dailyCapUsd" | "userDailyCapUsd" | "lockTimeoutMs" | "maxConcurrent"
> & {
  /** Cupo diario en segundos; ausente = `VOICE_DAILY_MINUTES` o 20 minutos. */
  dailySeconds?: number;
};

export type VoiceReservation =
  | { ok: true; reservationId: string; label: string }
  | { ok: false; reason: "daily_limit" | "global" | "user"; remainingSeconds?: number };

export async function reserveVoice(
  db: Db,
  input: { userId: string; seconds: number; requestId: string; now?: () => Date } & VoiceCaps,
): Promise<VoiceReservation> {
  const { userId, seconds, requestId, dailySeconds, ...rest } = input;
  const label = voiceLabel(seconds, requestId);
  const daily = dailySeconds ?? voiceDailySeconds(process.env);
  let remaining: number | undefined;
  const r = await reserveSpendWithGate<"daily_limit">(
    db,
    { ...rest, userId, label, estimateUsd: voiceReserveUsd(seconds) },
    async (tx, now) => {
      const done = await tx
        .select({ label: s.llmCalls.label })
        .from(s.llmCalls)
        .where(
          and(
            eq(s.llmCalls.userId, userId),
            eq(s.llmCalls.task, VOICE_TASK),
            eq(s.llmCalls.ok, true),
            like(s.llmCalls.label, `${VOICE_LABEL_PREFIX}%`),
            gte(s.llmCalls.createdAt, new Date(now.getTime() - DAY_MS)),
          ),
        );
      const live = await tx
        .select({ label: s.llmCalls.label })
        .from(s.llmCalls)
        .where(
          and(
            eq(s.llmCalls.userId, userId),
            eq(s.llmCalls.task, LLM_RESERVE_TASK),
            like(s.llmCalls.label, `${VOICE_LABEL_PREFIX}%`),
            gte(s.llmCalls.createdAt, new Date(now.getTime() - LLM_RESERVE_TTL_MS)),
          ),
        );
      const doneSeconds = secondsByRequest(done);
      const liveSeconds = secondsByRequest(live);
      // Una etiqueta cuenta una sola vez: la que ya tiene fila real no se suma otra vez como reservada
      for (const id of doneSeconds.keys()) liveSeconds.delete(id);
      const decision = voiceQuotaDecision({
        usedSeconds: sum(doneSeconds),
        reservedSeconds: sum(liveSeconds),
        requestSeconds: seconds,
        dailySeconds: daily,
      });
      if (decision.ok) return null;
      remaining = decision.remainingSeconds;
      return "daily_limit";
    },
  );
  if (r.ok) return { ok: true, reservationId: r.reservationId, label };
  return remaining === undefined
    ? { ok: false, reason: r.reason }
    : { ok: false, reason: r.reason, remainingSeconds: remaining };
}

function secondsByRequest(rows: { label: string | null }[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of rows) {
    const parsed = parseVoiceLabel(row.label);
    if (parsed) out.set(parsed.requestId, parsed.seconds);
  }
  return out;
}

const sum = (m: Map<string, number>): number => [...m.values()].reduce((a, b) => a + b, 0);

/** Idempotente y nunca lanza: se llama en un `finally`. */
export async function releaseVoiceReservation(db: Db, reservationId: string): Promise<boolean> {
  return releaseLlmSpend(db, reservationId);
}
