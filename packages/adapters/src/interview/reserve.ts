import type { Db } from "@job-search-os/db";
import { decideInterviewStart, interviewMaxSimulationsPerDay } from "@job-search-os/pipeline";
import {
  releaseLlmSpend,
  reserveLlmSpend,
  reserveSpendWithGate,
  type SpendReserveInput,
} from "../llm/spend-reserve";
import {
  INTERVIEW_LABEL_PREFIX,
  INTERVIEW_START_LABEL_PREFIX,
  startedInterviewIds,
} from "./starts";

/**
 * Reservas de gasto del simulador de entrevistas. Mismo esquema que el chat de CV y el asistente
 * (`llm/spend-reserve.ts`): transacción corta con lock que mide lo gastado más lo reservado y, si entra en los
 * topes (global y por persona), anota una fila de reserva; la llamada al modelo va afuera; la reserva se suelta
 * en un `finally` y, si el proceso muere, deja de contar cuando vence (`LLM_RESERVE_TTL_MS`).
 *
 * El tope de simulaciones por día se decide en la misma transacción, bajo el mismo lock. Una simulación en
 * curso se cuenta por la etiqueta `interview_start:<id>` de su reserva viva y, ya creada, por su fila: así dos
 * pedidos en paralelo de la misma persona no pasan los dos. La etiqueta lleva el id de la simulación, que es
 * el mismo en las dos fuentes, y se cuenta una sola vez.
 */
export { INTERVIEW_LABEL_PREFIX, INTERVIEW_START_LABEL_PREFIX };
export const interviewLabel = (sessionId: string): string =>
  `${INTERVIEW_LABEL_PREFIX}${sessionId}`;

/** Máximo de generar las 5 preguntas (modelo chico) con el modelo de respaldo incluido. */
export const INTERVIEW_QUESTIONS_RESERVE_USD = 0.03;
/** Máximo de evaluar una respuesta (modelo mediano) con el modelo de respaldo incluido. */
export const INTERVIEW_FEEDBACK_RESERVE_USD = 0.06;

export type InterviewCaps = Pick<
  SpendReserveInput,
  "dailyCapUsd" | "userDailyCapUsd" | "lockTimeoutMs" | "maxConcurrent"
>;

export type InterviewStartReservation =
  { ok: true; reservationId: string } | { ok: false; reason: "daily_limit" | "global" | "user" };

/**
 * Reserva para empezar una simulación. `db` es la conexión de servicio (ve `llm_calls` de todos y las
 * simulaciones de la persona; el filtro por `user_id` es explícito).
 */
export async function reserveInterviewStart(
  db: Db,
  input: {
    userId: string;
    sessionId: string;
    now?: () => Date;
    /** Entorno de donde sale `INTERVIEW_MAX_SIMULATIONS_PER_DAY`; ausente = `process.env`. */
    env?: Record<string, string | undefined>;
  } & InterviewCaps,
): Promise<InterviewStartReservation> {
  const { userId, sessionId, env, ...rest } = input;
  const maxPerDay = interviewMaxSimulationsPerDay(env ?? process.env);
  const r = await reserveSpendWithGate<"daily_limit">(
    db,
    {
      ...rest,
      userId,
      label: `${INTERVIEW_START_LABEL_PREFIX}${sessionId}`,
      estimateUsd: INTERVIEW_QUESTIONS_RESERVE_USD,
    },
    async (tx, now) => {
      // Cuenta también las borradas (llamadas de `llm_calls`): ver `starts.ts`
      const started = await startedInterviewIds(tx as unknown as Db, userId, now);
      const decision = decideInterviewStart(started.size, maxPerDay);
      return decision.ok ? null : "daily_limit";
    },
  );
  if (r.ok) return { ok: true, reservationId: r.reservationId };
  return { ok: false, reason: r.reason };
}

export type InterviewFeedbackReservation =
  | { ok: true; reservationId: string }
  | { ok: false; reason: "global" | "user" | "concurrent" | "lock_timeout" };

/** Reserva para evaluar una respuesta: topes globales y por persona, y tope de pedidos vivos. */
export async function reserveInterviewFeedback(
  db: Db,
  input: { userId: string; sessionId: string; now?: () => Date } & InterviewCaps,
): Promise<InterviewFeedbackReservation> {
  const { sessionId, ...rest } = input;
  return reserveLlmSpend(db, {
    ...rest,
    label: interviewLabel(sessionId),
    estimateUsd: INTERVIEW_FEEDBACK_RESERVE_USD,
  });
}

/** Idempotente y nunca lanza: se llama en un `finally`. */
export async function releaseInterviewReservation(db: Db, reservationId: string): Promise<boolean> {
  return releaseLlmSpend(db, reservationId);
}
