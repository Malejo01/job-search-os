import { schema as s, type Db } from "@job-search-os/db";
import { ASSISTANT_WINDOW_DAYS } from "@job-search-os/pipeline";
import { and, eq, gte, like, or } from "drizzle-orm";
import { ASSISTANT_TASK } from "./agent";
import { LLM_RESERVE_TASK } from "./spend";
import { LLM_RESERVE_TTL_MS, releaseLlmSpend, reserveSpendWithGate } from "./spend-reserve";

/**
 * Turno del asistente: en una sola decisión bajo lock mira si la persona ya tiene un turno en curso,
 * el cupo de charlas del mes y los topes de gasto. La reserva vale entre instancias porque vive en la
 * base, y se suelta al terminar el turno. Si el proceso muere, deja de bloquear cuando pasa la ventana.
 */

/** Máximo de un turno: 6 pasos del modelo a USD 0,03. */
export const ASSISTANT_TURN_RESERVE_USD = 0.18;
/** Más que el deadline del turno (50 s): un turno colgado no deja a la persona sin asistente. */
export const ASSISTANT_TURN_BUSY_MS = 70_000;

const CONVERSATION_LABELS = "conv:%";

export type AssistantTurnReservation =
  | { ok: true; reservationId: string }
  | { ok: false; reason: "busy" | "monthly" | "global" | "user" };

export async function reserveAssistantTurn(
  db: Db,
  input: {
    userId: string;
    label: string;
    monthlyLimit: number;
    now?: () => Date;
    dailyCapUsd?: number;
    userDailyCapUsd?: number;
  },
): Promise<AssistantTurnReservation> {
  const { userId, label, monthlyLimit, ...caps } = input;
  return reserveSpendWithGate<"busy" | "monthly">(
    db,
    { ...caps, userId, label, estimateUsd: ASSISTANT_TURN_RESERVE_USD },
    async (tx, now) => {
      const c = s.llmCalls;
      const inFlight = await tx
        .select({ id: c.id })
        .from(c)
        .where(
          and(
            eq(c.userId, userId),
            eq(c.task, LLM_RESERVE_TASK),
            like(c.label, CONVERSATION_LABELS),
            gte(c.createdAt, new Date(now.getTime() - ASSISTANT_TURN_BUSY_MS)),
          ),
        )
        .limit(1);
      if (inFlight.length > 0) return "busy";

      // Las charlas con pasos del modelo más las que están en curso y todavía no registraron ninguno
      const rows = await tx
        .selectDistinct({ label: c.label })
        .from(c)
        .where(
          and(
            eq(c.userId, userId),
            like(c.label, CONVERSATION_LABELS),
            gte(c.createdAt, new Date(now.getTime() - ASSISTANT_WINDOW_DAYS * 24 * 60 * 60 * 1000)),
            or(
              eq(c.task, ASSISTANT_TASK),
              and(
                eq(c.task, LLM_RESERVE_TASK),
                gte(c.createdAt, new Date(now.getTime() - LLM_RESERVE_TTL_MS)),
              ),
            ),
          ),
        );
      const labels = new Set(rows.map((r) => r.label));
      if (labels.has(label)) return null;
      return labels.size < monthlyLimit ? null : "monthly";
    },
  );
}

/** Idempotente y nunca lanza: se llama en un `finally`. */
export async function releaseAssistantTurn(db: Db, reservationId: string): Promise<boolean> {
  return releaseLlmSpend(db, reservationId);
}
