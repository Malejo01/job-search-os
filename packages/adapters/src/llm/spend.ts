import { schema as s, type Db } from "@job-search-os/db";
import { and, desc, eq, gte, isNotNull, sql } from "drizzle-orm";

/**
 * Gasto acumulado en `llm_calls` (guardarraíl de costo). La ventana es móvil de 24 h, no
 * "día calendario": así el tope no se resetea a medianoche en medio de una tanda.
 * Las llamadas sin tarifa (cost_usd null) se cuentan aparte: el tope no las ve, y eso se
 * informa para que no pase inadvertido.
 */
export type SpendSummary = {
  since: Date;
  calls: number;
  failedCalls: number;
  /** Llamadas ok sin cost_usd (sin tarifa en model_routing para ese modelo). */
  unpricedCalls: number;
  tokensIn: number;
  tokensOut: number;
  tokensReasoning: number;
  usd: number;
};

export const DEFAULT_DAILY_CAP_USD = 2;

/** Tope diario desde LLM_DAILY_CAP_USD; 0 desactiva el guardarraíl (a propósito y a la vista). */
export function dailyCapFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.LLM_DAILY_CAP_USD;
  if (raw === undefined || raw === "") return DEFAULT_DAILY_CAP_USD;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`LLM_DAILY_CAP_USD inválido: '${raw}' (USD, ≥ 0; 0 = sin tope)`);
  }
  return n;
}

export const DEFAULT_USER_DAILY_CAP_USD = 1;

/**
 * Tope diario por usuario (JS-093) desde LLM_USER_DAILY_CAP_USD, además del global: un usuario
 * no puede gastar el cupo de todos. 0 lo desactiva; vacío usa el default.
 */
export function userDailyCapUsd(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.LLM_USER_DAILY_CAP_USD;
  if (raw === undefined || raw === "") return DEFAULT_USER_DAILY_CAP_USD;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`LLM_USER_DAILY_CAP_USD inválido: '${raw}' (USD, ≥ 0; 0 = sin tope)`);
  }
  return n;
}

/** Con `userId` suma solo las llamadas de ese usuario; sin él, todas (tope global). */
export async function spendSince(
  db: Db,
  since: Date,
  options: { userId?: string } = {},
): Promise<SpendSummary> {
  const [row] = await db
    .select({
      calls: sql<number>`count(*)::int`,
      failedCalls: sql<number>`count(*) filter (where not ${s.llmCalls.ok})::int`,
      unpricedCalls: sql<number>`count(*) filter (where ${s.llmCalls.ok} and ${s.llmCalls.costUsd} is null)::int`,
      tokensIn: sql<number>`coalesce(sum(${s.llmCalls.tokensIn}), 0)::int`,
      tokensOut: sql<number>`coalesce(sum(${s.llmCalls.tokensOut}), 0)::int`,
      tokensReasoning: sql<number>`coalesce(sum(${s.llmCalls.tokensReasoning}), 0)::int`,
      usd: sql<number>`coalesce(sum(${s.llmCalls.costUsd}), 0)::float8`,
    })
    .from(s.llmCalls)
    .where(
      and(
        gte(s.llmCalls.createdAt, since),
        options.userId ? eq(s.llmCalls.userId, options.userId) : undefined,
      ),
    );
  return { since, ...row! };
}

export const spendLast24h = (
  db: Db,
  now: () => Date = () => new Date(),
  options: { userId?: string } = {},
): Promise<SpendSummary> =>
  spendSince(db, new Date(now().getTime() - 24 * 60 * 60 * 1000), options);

/**
 * Chequeo de topes antes de una llamada al modelo fuera del worker (borradores de formularios,
 * JS-093): `"global"` si el gasto de 24 h de todos supera LLM_DAILY_CAP_USD, `"user"` si el del
 * usuario supera LLM_USER_DAILY_CAP_USD, null si puede seguir. `db` tiene que ver `llm_calls` de
 * todos (conexión de servicio, no la transacción con RLS del usuario). Mismas reglas que el worker.
 */
export async function spendCapReason(
  db: Db,
  input: {
    userId: string;
    now?: () => Date;
    dailyCapUsd?: number;
    userDailyCapUsd?: number;
  },
): Promise<"global" | "user" | null> {
  const globalCap = input.dailyCapUsd ?? dailyCapFromEnv();
  if (globalCap > 0 && (await spendLast24h(db, input.now)).usd >= globalCap) return "global";
  const userCap = input.userDailyCapUsd ?? userDailyCapUsd();
  if (userCap > 0 && (await spendLast24h(db, input.now, { userId: input.userId })).usd >= userCap) {
    return "user";
  }
  return null;
}

/** Desglose por día, tarea y modelo (comando `pnpm llm:spend`). */
export type SpendRow = {
  day: string;
  task: string;
  model: string;
  calls: number;
  ok: number;
  tokensIn: number;
  tokensOut: number;
  tokensReasoning: number;
  avgOut: number;
  usd: number;
};

export async function spendBreakdown(db: Db, since: Date): Promise<SpendRow[]> {
  const rows = await db
    .select({
      day: sql<string>`to_char(${s.llmCalls.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`,
      task: s.llmCalls.task,
      model: s.llmCalls.model,
      calls: sql<number>`count(*)::int`,
      ok: sql<number>`count(*) filter (where ${s.llmCalls.ok})::int`,
      tokensIn: sql<number>`coalesce(sum(${s.llmCalls.tokensIn}), 0)::int`,
      tokensOut: sql<number>`coalesce(sum(${s.llmCalls.tokensOut}), 0)::int`,
      tokensReasoning: sql<number>`coalesce(sum(${s.llmCalls.tokensReasoning}), 0)::int`,
      avgOut: sql<number>`coalesce(round(avg(${s.llmCalls.tokensOut})), 0)::int`,
      usd: sql<number>`coalesce(sum(${s.llmCalls.costUsd}), 0)::float8`,
    })
    .from(s.llmCalls)
    .where(gte(s.llmCalls.createdAt, since))
    .groupBy(sql`1`, s.llmCalls.task, s.llmCalls.model)
    .orderBy(sql`1`, s.llmCalls.task, s.llmCalls.model);
  return rows;
}

/**
 * Promedio de tokens de las últimas llamadas ok de un modelo en `llm_calls`, para estimar el
 * costo de una corrida con historia real en vez de un supuesto. `withReasoning` separa las
 * llamadas que gastaron thinking (tokens_reasoning > 0) de las que no: el nivel de thinking no
 * se persiste, y esa es la partición que cambia el costo (el thinking se factura como salida).
 * Devuelve null si hay menos de `minCalls` llamadas (historia insuficiente).
 */
export type TokenAverage = { calls: number; tokensIn: number; tokensOut: number };

export async function averageTokensFor(
  db: Db,
  input: {
    model: string;
    withReasoning: boolean;
    taskPrefix?: string;
    limit?: number;
    minCalls?: number;
  },
): Promise<TokenAverage | null> {
  const limit = input.limit ?? 50;
  const minCalls = input.minCalls ?? 5;
  const reasoningFilter = input.withReasoning
    ? sql`coalesce(${s.llmCalls.tokensReasoning}, 0) > 0`
    : sql`coalesce(${s.llmCalls.tokensReasoning}, 0) = 0`;
  const taskFilter = input.taskPrefix
    ? sql`${s.llmCalls.task} like ${input.taskPrefix + "%"}`
    : sql`true`;
  const recent = db
    .select({ tokensIn: s.llmCalls.tokensIn, tokensOut: s.llmCalls.tokensOut })
    .from(s.llmCalls)
    .where(
      and(
        eq(s.llmCalls.model, input.model),
        eq(s.llmCalls.ok, true),
        isNotNull(s.llmCalls.tokensIn),
        isNotNull(s.llmCalls.tokensOut),
        reasoningFilter,
        taskFilter,
      ),
    )
    .orderBy(desc(s.llmCalls.createdAt))
    .limit(limit)
    .as("recent");
  const [row] = await db
    .select({
      calls: sql<number>`count(*)::int`,
      tokensIn: sql<number>`coalesce(round(avg(${recent.tokensIn})), 0)::int`,
      tokensOut: sql<number>`coalesce(round(avg(${recent.tokensOut})), 0)::int`,
    })
    .from(recent);
  if (!row || row.calls < minCalls) return null;
  return row;
}
