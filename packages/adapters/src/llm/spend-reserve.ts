import { schema as s, type Db } from "@job-search-os/db";
import { and, eq, gte, sql } from "drizzle-orm";
import {
  dailyCapFromEnv,
  globalCapReached,
  LLM_RESERVE_TASK,
  spendLast24h,
  userDailyCapUsd,
} from "./spend";

/**
 * Reserva de gasto antes de llamar al modelo, para la evaluación inmediata y los borradores. Mismo esquema
 * que el chat de CV (`cv-chat/reserve.ts`), sin locks que crucen transacciones:
 *  1. transacción corta con lock: medir lo gastado más lo reservado y, si entra en el tope, anotar la reserva;
 *  2. la llamada al modelo va afuera de la transacción;
 *  3. otra transacción corta borra la reserva. La fila real la registra el cliente LLM.
 * Si el proceso muere, la reserva deja de contar cuando vence.
 *
 * El lock es uno solo para todos: el tope global también se decide acá, y la transacción dura milisegundos.
 * La reserva lleva `cost_usd` null y su estimado en `tokens_out`, en millonésimas de USD.
 */
export const LLM_RESERVE_TTL_MS = 5 * 60 * 1000;

/** Máximo de una evaluación con el modelo de respaldo incluido. */
export const EVALUATION_RESERVE_USD = 0.1;
/** Máximo de una tanda de borradores con el modelo de respaldo incluido. */
export const DRAFTS_RESERVE_USD = 0.12;

const LOCK_NAMESPACE = 7102;
const LOCK_KEY = "llm_spend_reserve";
const MICRO_USD = 1_000_000;

export type SpendReservation =
  { ok: true; reservationId: string } | { ok: false; reason: "global" | "user" };

export type SpendReserveInput = {
  userId: string;
  estimateUsd: number;
  /** Etiqueta de la fila de reserva: la usa el asistente para saber qué charla está en curso. */
  label?: string;
  now?: () => Date;
  dailyCapUsd?: number;
  userDailyCapUsd?: number;
};

/** Control extra que corre bajo el mismo lock, antes de medir los topes. Devuelve el motivo para frenar. */
export type SpendGate<R extends string> = (
  tx: Pick<Db, "select" | "selectDistinct">,
  now: Date,
) => Promise<R | null>;

/** Reserva `estimateUsd` para la persona, o dice qué tope lo impide. `db` tiene que ver `llm_calls` de todos. */
export async function reserveLlmSpend(db: Db, input: SpendReserveInput): Promise<SpendReservation> {
  return reserveSpendWithGate<never>(db, input, async () => null);
}

/** Igual que `reserveLlmSpend`, con una condición propia decidida en la misma transacción. */
export async function reserveSpendWithGate<R extends string>(
  db: Db,
  input: SpendReserveInput,
  gate: SpendGate<R>,
): Promise<{ ok: true; reservationId: string } | { ok: false; reason: "global" | "user" | R }> {
  const clock = input.now ?? (() => new Date());
  const now = clock();
  const globalCap = input.dailyCapUsd ?? dailyCapFromEnv();
  const userCap = input.userDailyCapUsd ?? userDailyCapUsd();

  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${LOCK_KEY}, ${LOCK_NAMESPACE}))`,
    );

    const blocked = await gate(tx, now);
    if (blocked !== null) return { ok: false as const, reason: blocked };

    const c = s.llmCalls;
    const [live] = await tx
      .select({
        all: sql<number>`coalesce(sum(${c.tokensOut}), 0)::float8`,
        mine: sql<number>`coalesce(sum(${c.tokensOut}) filter (where ${c.userId} = ${input.userId}), 0)::float8`,
      })
      .from(c)
      .where(
        and(
          eq(c.task, LLM_RESERVE_TASK),
          gte(c.createdAt, new Date(now.getTime() - LLM_RESERVE_TTL_MS)),
        ),
      );
    const reservedAll = (live?.all ?? 0) / MICRO_USD;
    const reservedMine = (live?.mine ?? 0) / MICRO_USD;

    const mineUsd = (await spendLast24h(tx, clock, { userId: input.userId })).usd + reservedMine;
    if (globalCap > 0) {
      const totalUsd = (await spendLast24h(tx, clock)).usd + reservedAll;
      if (globalCapReached({ capUsd: globalCap, totalUsd, mineUsd })) {
        return { ok: false as const, reason: "global" as const };
      }
    }
    if (userCap > 0 && mineUsd >= userCap) {
      return { ok: false as const, reason: "user" as const };
    }

    const [row] = await tx
      .insert(c)
      .values({
        userId: input.userId,
        task: LLM_RESERVE_TASK,
        model: "none",
        promptVersion: `${LLM_RESERVE_TASK}@v1`,
        label: input.label ?? null,
        tokensOut: Math.max(0, Math.round(input.estimateUsd * MICRO_USD)),
        costUsd: null,
        latencyMs: 0,
        ok: true,
        createdAt: now,
      })
      .returning({ id: c.id });
    return { ok: true as const, reservationId: row!.id };
  });
}

/**
 * Borra la reserva bajo el mismo lock: así nadie mide entre que se borra y que la fila real ya se ve.
 * Idempotente y nunca lanza, porque se llama en un `finally`. Devuelve `false` si falló: la reserva que
 * quede deja de contar cuando vence.
 */
export async function releaseLlmSpend(db: Db, reservationId: string): Promise<boolean> {
  try {
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${LOCK_KEY}, ${LOCK_NAMESPACE}))`,
      );
      await tx
        .delete(s.llmCalls)
        .where(and(eq(s.llmCalls.id, reservationId), eq(s.llmCalls.task, LLM_RESERVE_TASK)));
    });
    return true;
  } catch {
    return false;
  }
}
