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

export const SPEND_LOCK_NAMESPACE = 7102;
export const SPEND_LOCK_KEY = "llm_spend_reserve";
const LOCK_NAMESPACE = SPEND_LOCK_NAMESPACE;
const LOCK_KEY = SPEND_LOCK_KEY;
const MICRO_USD = 1_000_000;

/** Espera máxima por el lock global: si vence, la reserva se rechaza (falla cerrado). */
export const DEFAULT_LOCK_TIMEOUT_MS = 3000;
const MIN_LOCK_TIMEOUT_MS = 100;
const MAX_LOCK_TIMEOUT_MS = 5000;

/** Reservas vivas por persona a partir de las cuales un pedido nuevo se rechaza sin tomar el lock. */
export const DEFAULT_MAX_CONCURRENT_RESERVATIONS = 3;

/** Desde LLM_RESERVE_MAX_CONCURRENT; vacío o inválido (no entero ≥ 1) usa el valor por defecto. */
export function maxConcurrentFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.LLM_RESERVE_MAX_CONCURRENT?.trim();
  if (!raw || !/^\d+$/.test(raw)) return DEFAULT_MAX_CONCURRENT_RESERVATIONS;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n >= 1 ? n : DEFAULT_MAX_CONCURRENT_RESERVATIONS;
}

export type SpendReservation =
  | { ok: true; reservationId: string }
  | { ok: false; reason: "global" | "user" | "concurrent" | "lock_timeout" };

export type SpendReserveInput = {
  userId: string;
  estimateUsd: number;
  /** Etiqueta de la fila de reserva: la usa el asistente para saber qué charla está en curso. */
  label?: string;
  now?: () => Date;
  dailyCapUsd?: number;
  userDailyCapUsd?: number;
  /** Espera máxima por el lock global (ms, entre 100 y 5000). Default 3000. */
  lockTimeoutMs?: number;
  /** Reservas vivas de la persona a partir de las cuales se rechaza. Default LLM_RESERVE_MAX_CONCURRENT o 3. */
  maxConcurrent?: number;
};

/** Reservas vivas desde `now - TTL`: cuántas y cuánto suman (micro USD en `tokens_out`). Sin ejecutar. */
export function liveReservationsQuery(
  db: Pick<Db, "select">,
  now: Date,
  options: { userId?: string } = {},
) {
  const c = s.llmCalls;
  return db
    .select({
      n: sql<number>`count(*)::int`,
      all: sql<number>`coalesce(sum(${c.tokensOut}), 0)::float8`,
      mine: options.userId
        ? sql<number>`coalesce(sum(${c.tokensOut}) filter (where ${c.userId} = ${options.userId}), 0)::float8`
        : sql<number>`0::float8`,
      mineCount: options.userId
        ? sql<number>`count(*) filter (where ${c.userId} = ${options.userId})::int`
        : sql<number>`0::int`,
    })
    .from(c)
    .where(
      and(
        eq(c.task, LLM_RESERVE_TASK),
        gte(c.createdAt, new Date(now.getTime() - LLM_RESERVE_TTL_MS)),
      ),
    );
}

/** `lock_not_available` (55P03): vence `lock_timeout`. El error puede venir envuelto por el driver. */
function isLockTimeout(e: unknown): boolean {
  for (let cur = e, i = 0; cur && typeof cur === "object" && i < 4; i++) {
    if ((cur as { code?: unknown }).code === "55P03") return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

const clampLockTimeout = (ms: number | undefined): number =>
  ms !== undefined && Number.isFinite(ms)
    ? Math.min(MAX_LOCK_TIMEOUT_MS, Math.max(MIN_LOCK_TIMEOUT_MS, Math.round(ms)))
    : DEFAULT_LOCK_TIMEOUT_MS;

/** Toma el lock global dentro de la transacción, esperando como mucho `lockTimeoutMs`. */
async function takeSpendLock(tx: Pick<Db, "execute">, lockTimeoutMs: number): Promise<void> {
  // SET no admite parámetros: el valor es un entero ya acotado
  await tx.execute(sql.raw(`set local lock_timeout = ${lockTimeoutMs}`));
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${LOCK_KEY}, ${LOCK_NAMESPACE}))`,
  );
}

/** Control extra que corre bajo el mismo lock, antes de medir los topes. Devuelve el motivo para frenar. */
export type SpendGate<R extends string> = (
  tx: Pick<Db, "select" | "selectDistinct">,
  now: Date,
) => Promise<R | null>;

/** Reserva `estimateUsd` para la persona, o dice qué tope lo impide. `db` tiene que ver `llm_calls` de todos. */
export async function reserveLlmSpend(db: Db, input: SpendReserveInput): Promise<SpendReservation> {
  const clock = input.now ?? (() => new Date());
  const userCap = input.userDailyCapUsd ?? userDailyCapUsd();
  const maxConcurrent =
    input.maxConcurrent !== undefined &&
    Number.isSafeInteger(input.maxConcurrent) &&
    input.maxConcurrent >= 1
      ? input.maxConcurrent
      : maxConcurrentFromEnv();

  // Chequeo barato SIN lock: una persona topeada o con demasiados pedidos vivos no hace cola por el lock global.
  // Es una vista previa (los pedidos simultáneos aún no se ven entre sí); la decisión firme sigue bajo lock.
  const [mineLive] = await liveReservationsQuery(db, clock(), { userId: input.userId });
  if ((mineLive?.mineCount ?? 0) >= maxConcurrent) {
    return { ok: false, reason: "concurrent" };
  }
  if (userCap > 0) {
    const reservedMine = (mineLive?.mine ?? 0) / MICRO_USD;
    const mineUsd = (await spendLast24h(db, clock, { userId: input.userId })).usd + reservedMine;
    if (mineUsd >= userCap) {
      // Misma precedencia que bajo lock: si el tope global también frena, ese es el motivo
      const globalCap = input.dailyCapUsd ?? dailyCapFromEnv();
      if (globalCap > 0) {
        const totalUsd = (await spendLast24h(db, clock)).usd + (mineLive?.all ?? 0) / MICRO_USD;
        if (globalCapReached({ capUsd: globalCap, totalUsd, mineUsd })) {
          return { ok: false, reason: "global" };
        }
      }
      return { ok: false, reason: "user" };
    }
  }

  return reserveCore<never>(db, input, async () => null);
}

/**
 * Igual que `reserveLlmSpend`, con una condición propia decidida en la misma transacción. Quien llama
 * decide sus propios controles previos; un `lock_timeout` vencido se informa como `global` (servicio
 * saturado: probar más tarde), así este tipo de resultado no cambia para sus llamadores.
 */
export async function reserveSpendWithGate<R extends string>(
  db: Db,
  input: SpendReserveInput,
  gate: SpendGate<R>,
): Promise<{ ok: true; reservationId: string } | { ok: false; reason: "global" | "user" | R }> {
  const r = await reserveCore<R>(db, input, gate);
  if (!r.ok && r.reason === "lock_timeout") {
    return { ok: false, reason: "global" };
  }
  return r as { ok: true; reservationId: string } | { ok: false; reason: "global" | "user" | R };
}

async function reserveCore<R extends string>(
  db: Db,
  input: SpendReserveInput,
  gate: SpendGate<R>,
): Promise<
  | { ok: true; reservationId: string }
  | { ok: false; reason: "global" | "user" | "lock_timeout" | R }
> {
  const clock = input.now ?? (() => new Date());
  const now = clock();
  const globalCap = input.dailyCapUsd ?? dailyCapFromEnv();
  const userCap = input.userDailyCapUsd ?? userDailyCapUsd();
  const lockTimeoutMs = clampLockTimeout(input.lockTimeoutMs);

  try {
    return await db.transaction(async (tx) => {
      await takeSpendLock(tx, lockTimeoutMs);

      const blocked = await gate(tx, now);
      if (blocked !== null) return { ok: false as const, reason: blocked };

      const c = s.llmCalls;
      const [live] = await liveReservationsQuery(tx, now, { userId: input.userId });
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
  } catch (e) {
    // Falla cerrado con motivo propio; cualquier otro error sigue siendo un error
    if (isLockTimeout(e)) return { ok: false, reason: "lock_timeout" };
    throw e;
  }
}

/**
 * Borra la reserva bajo el mismo lock: así nadie mide entre que se borra y que la fila real ya se ve.
 * Idempotente y nunca lanza, porque se llama en un `finally`. Devuelve `false` si falló: la reserva que
 * quede deja de contar cuando vence.
 */
export async function releaseLlmSpend(db: Db, reservationId: string): Promise<boolean> {
  try {
    await db.transaction(async (tx) => {
      await takeSpendLock(tx, DEFAULT_LOCK_TIMEOUT_MS);
      await tx
        .delete(s.llmCalls)
        .where(and(eq(s.llmCalls.id, reservationId), eq(s.llmCalls.task, LLM_RESERVE_TASK)));
    });
    return true;
  } catch {
    return false;
  }
}
