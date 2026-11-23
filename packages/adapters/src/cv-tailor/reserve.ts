import { schema as s, type Db } from "@job-search-os/db";
import { decideCvTailorStart } from "@job-search-os/pipeline";
import { and, gte, like, eq } from "drizzle-orm";
import { LLM_RESERVE_TASK } from "../llm/spend";
import {
  LLM_RESERVE_TTL_MS,
  releaseLlmSpend,
  reserveSpendWithGate,
  type SpendReserveInput,
} from "../llm/spend-reserve";

/**
 * Reserva de gasto y tope diario de la versión del CV adaptada con IA (R20-04). Mismo esquema que el simulador
 * de entrevistas y el chat de CV (`llm/spend-reserve.ts`): transacción corta con lock que mide lo gastado más lo
 * reservado y, si entra en los topes (global y por persona), anota una fila de reserva; la llamada al modelo va
 * afuera; la reserva se suelta en un `finally` y, si el proceso muere, deja de contar cuando vence.
 *
 * El tope de 3 por día se decide en la misma transacción, bajo el mismo lock. Un pedido se cuenta por su etiqueta
 * `cv_tailor:<id>`: la lleva la reserva viva y la lleva la fila que el cliente LLM deja en `llm_calls` (una por
 * intento, también las fallidas que llegaron al proveedor). Se cuenta una etiqueta una sola vez, así que dos
 * pedidos en paralelo de la misma persona no pasan los dos y un intento con respaldo no cuenta doble.
 */
export const CV_TAILOR_TASK = "cv_tailor";
export const CV_TAILOR_LABEL_PREFIX = "cv_tailor:";
export const cvTailorLabel = (requestId: string): string => `${CV_TAILOR_LABEL_PREFIX}${requestId}`;

/**
 * Máximo de un pedido con el respaldo incluido: primario y respaldo agotando `max_tokens` con el prompt en su
 * tope. Atado al seed de `model_routing` por `reserve.test.ts`.
 */
export const CV_TAILOR_RESERVE_USD = 0.12;

const DAY_MS = 24 * 60 * 60 * 1000;

export type CvTailorCaps = Pick<
  SpendReserveInput,
  "dailyCapUsd" | "userDailyCapUsd" | "lockTimeoutMs" | "maxConcurrent"
>;

export type CvTailorReservation =
  { ok: true; reservationId: string } | { ok: false; reason: "daily_limit" | "global" | "user" };

export async function reserveCvTailor(
  db: Db,
  input: { userId: string; requestId: string; now?: () => Date } & CvTailorCaps,
): Promise<CvTailorReservation> {
  const { userId, requestId, ...rest } = input;
  const r = await reserveSpendWithGate<"daily_limit">(
    db,
    { ...rest, userId, label: cvTailorLabel(requestId), estimateUsd: CV_TAILOR_RESERVE_USD },
    async (tx, now) => {
      const done = await tx
        .selectDistinct({ label: s.llmCalls.label })
        .from(s.llmCalls)
        .where(
          and(
            eq(s.llmCalls.userId, userId),
            eq(s.llmCalls.task, CV_TAILOR_TASK),
            like(s.llmCalls.label, `${CV_TAILOR_LABEL_PREFIX}%`),
            gte(s.llmCalls.createdAt, new Date(now.getTime() - DAY_MS)),
          ),
        );
      const live = await tx
        .selectDistinct({ label: s.llmCalls.label })
        .from(s.llmCalls)
        .where(
          and(
            eq(s.llmCalls.userId, userId),
            eq(s.llmCalls.task, LLM_RESERVE_TASK),
            like(s.llmCalls.label, `${CV_TAILOR_LABEL_PREFIX}%`),
            gte(s.llmCalls.createdAt, new Date(now.getTime() - LLM_RESERVE_TTL_MS)),
          ),
        );
      const used = new Set<string>([...done, ...live].map((row) => row.label ?? ""));
      used.delete("");
      return decideCvTailorStart(used.size).ok ? null : "daily_limit";
    },
  );
  if (r.ok) return { ok: true, reservationId: r.reservationId };
  return { ok: false, reason: r.reason };
}

/** Idempotente y nunca lanza: se llama en un `finally`. */
export async function releaseCvTailorReservation(db: Db, reservationId: string): Promise<boolean> {
  return releaseLlmSpend(db, reservationId);
}
