import { schema as s, type Db } from "@job-search-os/db";
import {
  JOB_CARD_TASK,
  JOB_CARD_LABEL_PREFIX,
  canRetryJobCard,
  decideJobCardStart,
  jobCardCapsFromEnv,
  jobCardReservationLabel,
  type JobCardCaps,
} from "@job-search-os/pipeline";
import { and, eq, gte, like, sql } from "drizzle-orm";
import {
  FAILED_CALL_ESTIMATE_USD,
  LLM_RESERVE_TASK,
  dailyCapFromEnv,
  globalCapReached,
  spendLast24h,
} from "./spend";
import {
  DEFAULT_LOCK_TIMEOUT_MS,
  LLM_RESERVE_TTL_MS,
  liveReservationsQuery,
  releaseLlmSpend,
  takeSpendLock,
} from "./spend-reserve";

/**
 * Reserva y topes de la ficha del aviso (R31-03, ADR-048). Mismo esquema que las demás reservas de gasto
 * (`spend-reserve.ts`): una transacción corta con el lock global mide lo gastado y lo reservado y, si entra, anota
 * una fila de reserva; la llamada al modelo va afuera; la reserva se suelta en un `finally`.
 *
 * Diferencias: la ficha no es de nadie, así que la reserva y las llamadas van con `user_id` null (no queda registro
 * de quién la pidió) y la etiqueta es `job_card:<hash>`. Esa etiqueta cumple además otro papel: **mientras hay una
 * reserva viva para el mismo hash, nadie más llama al modelo por ese texto** (`in_flight`), así dos personas que
 * abren el mismo aviso a la vez no generan dos fichas. La restricción única de `job_cards.jd_hash` es el respaldo.
 *
 * Los topes propios (fichas y USD por día) son de `packages/pipeline/src/job-card/limits.ts`. Además rige el tope
 * global de gasto de todos (`LLM_DAILY_CAP_USD`), sin tocar la parte reservada a las personas que casi no gastaron.
 */

/**
 * Máximo de una ficha con el respaldo incluido: primario y respaldo agotando `max_tokens` con el aviso en su tope.
 * Atado al seed de `model_routing` por `job-card-reserve.test.ts`.
 */
export const JOB_CARD_RESERVE_USD = 0.07;

const MICRO_USD = 1_000_000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type JobCardReservation =
  | { ok: true; reservationId: string }
  | {
      ok: false;
      reason: "exists" | "in_flight" | "daily_count" | "daily_usd" | "global" | "lock_timeout";
    };

export type JobCardReserveInput = {
  hash: string;
  /** Vuelve a intentar una ficha `fallida` (con el máximo de intentos de `canRetryJobCard`). */
  retry?: boolean;
  now?: () => Date;
  caps?: JobCardCaps;
  /** Tope global de gasto (USD). Default `LLM_DAILY_CAP_USD`. 0 lo desactiva, como en el resto de la app. */
  globalCapUsd?: number;
  lockTimeoutMs?: number;
};

function isLockTimeout(e: unknown): boolean {
  for (let cur = e, i = 0; cur && typeof cur === "object" && i < 4; i++) {
    if ((cur as { code?: unknown }).code === "55P03") return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

type Reader = Pick<Db, "select" | "selectDistinct">;

/** Fichas intentadas y USD gastados en fichas en las últimas 24 h, y lo que hay reservado ahora. */
async function jobCardUsage(db: Reader, now: Date) {
  const c = s.llmCalls;
  const since24h = new Date(now.getTime() - DAY_MS);
  const [done] = await db
    .select({
      n: sql<number>`count(distinct ${c.label})::int`,
      usd: sql<number>`coalesce(sum(coalesce(${c.costUsd}, case when ${c.ok} then 0 else ${FAILED_CALL_ESTIMATE_USD}::float8 end)), 0)::float8`,
    })
    .from(c)
    .where(
      and(
        eq(c.task, JOB_CARD_TASK),
        gte(c.createdAt, since24h),
        // Un intento que nunca salió (primario sin clave) no se facturó ni cuenta como ficha
        sql`${c.error} is distinct from 'provider_unavailable'`,
      ),
    );
  const [live] = await db
    .select({
      n: sql<number>`count(*)::int`,
      micro: sql<number>`coalesce(sum(${c.tokensOut}), 0)::float8`,
    })
    .from(c)
    .where(
      and(
        eq(c.task, LLM_RESERVE_TASK),
        like(c.label, `${JOB_CARD_LABEL_PREFIX}%`),
        gte(c.createdAt, new Date(now.getTime() - LLM_RESERVE_TTL_MS)),
      ),
    );
  return {
    cardsLast24h: done?.n ?? 0,
    usdLast24h: done?.usd ?? 0,
    reservedCount: live?.n ?? 0,
    reservedUsd: (live?.micro ?? 0) / MICRO_USD,
  };
}

/** ¿Hay una ficha de este texto en curso? (reserva viva con su etiqueta) */
async function inFlight(db: Reader, hash: string, now: Date): Promise<boolean> {
  const c = s.llmCalls;
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(c)
    .where(
      and(
        eq(c.task, LLM_RESERVE_TASK),
        eq(c.label, jobCardReservationLabel(hash)),
        gte(c.createdAt, new Date(now.getTime() - LLM_RESERVE_TTL_MS)),
      ),
    );
  return (row?.n ?? 0) > 0;
}

/**
 * Motivo por el que hoy no se generan fichas nuevas (`null` si se puede), sin tomar el lock ni reservar: es para
 * que la pantalla diga «tope» sin intentar. La decisión firme la toma `reserveJobCard`.
 */
export async function jobCardCapReason(
  db: Db,
  options: { now?: () => Date; caps?: JobCardCaps; globalCapUsd?: number } = {},
): Promise<"daily_count" | "daily_usd" | "global" | null> {
  const clock = options.now ?? (() => new Date());
  const now = clock();
  const caps = options.caps ?? jobCardCapsFromEnv(process.env).caps;
  const usage = await jobCardUsage(db, now);
  const decision = decideJobCardStart({ caps, ...usage, estimateUsd: JOB_CARD_RESERVE_USD });
  if (!decision.ok) return decision.reason;
  return globalReason(db, clock, now, options.globalCapUsd);
}

async function globalReason(
  db: Reader,
  clock: () => Date,
  now: Date,
  globalCapUsd: number | undefined,
): Promise<"global" | null> {
  const globalCap = globalCapUsd ?? dailyCapFromEnv();
  if (!(globalCap > 0)) return null;
  const [live] = await liveReservationsQuery(db, now);
  const totalUsd =
    (await spendLast24h(db, clock, { excludeCvAgent: true })).usd + (live?.all ?? 0) / MICRO_USD;
  // La ficha no usa la parte del tope que se reserva a las personas que casi no gastaron: se pasa `mineUsd` en el
  // piso para que, entrando en esa parte, frene.
  return globalCapReached({ capUsd: globalCap, totalUsd, mineUsd: globalCap }) ? "global" : null;
}

export async function reserveJobCard(
  db: Db,
  input: JobCardReserveInput,
): Promise<JobCardReservation> {
  const clock = input.now ?? (() => new Date());
  const now = clock();
  const caps = input.caps ?? jobCardCapsFromEnv(process.env).caps;
  const lockTimeoutMs = input.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
  try {
    return await db.transaction(async (tx) => {
      await takeSpendLock(tx, lockTimeoutMs);

      // 1. ¿Ya hay ficha para este texto?
      const [row] = await tx
        .select({ status: s.jobCards.status, attempts: s.jobCards.attempts })
        .from(s.jobCards)
        .where(eq(s.jobCards.jdHash, input.hash))
        .limit(1);
      if (row && !(input.retry && canRetryJobCard(row))) {
        return { ok: false as const, reason: "exists" as const };
      }

      // 2. ¿La está generando otro pedido ahora mismo?
      if (await inFlight(tx, input.hash, now)) {
        return { ok: false as const, reason: "in_flight" as const };
      }

      // 3. Topes propios y tope global
      const usage = await jobCardUsage(tx, now);
      const decision = decideJobCardStart({ caps, ...usage, estimateUsd: JOB_CARD_RESERVE_USD });
      if (!decision.ok) return { ok: false as const, reason: decision.reason };
      if ((await globalReason(tx, clock, now, input.globalCapUsd)) === "global") {
        return { ok: false as const, reason: "global" as const };
      }

      const [res] = await tx
        .insert(s.llmCalls)
        .values({
          userId: null,
          task: LLM_RESERVE_TASK,
          model: "none",
          promptVersion: `${LLM_RESERVE_TASK}@v1`,
          label: jobCardReservationLabel(input.hash),
          tokensOut: Math.max(0, Math.round(JOB_CARD_RESERVE_USD * MICRO_USD)),
          costUsd: null,
          latencyMs: 0,
          ok: true,
          createdAt: now,
        })
        .returning({ id: s.llmCalls.id });
      return { ok: true as const, reservationId: res!.id };
    });
  } catch (e) {
    if (isLockTimeout(e)) return { ok: false, reason: "lock_timeout" };
    throw e;
  }
}

/** Idempotente y nunca lanza: se llama en un `finally`. */
export async function releaseJobCardReservation(db: Db, reservationId: string): Promise<boolean> {
  return releaseLlmSpend(db, reservationId);
}
