import { schema as s, type Db } from "@job-search-os/db";
import { and, desc, eq, gte, isNotNull, notInArray, sql } from "drizzle-orm";
import { PROFILE_AGENT_SPEND_TASKS } from "../profile-agent/measure";

/** Reserva de gasto de la evaluación inmediata y de los borradores (`spend-reserve.ts`). */
export const LLM_RESERVE_TASK = "llm_reserve";

/**
 * Filas de `llm_calls` que no son llamadas al modelo: las reservas de gasto (en vuelo, se borran al
 * terminar), el registro de inicio de charla (costo 0) y la marca de alerta de presupuesto enviada
 * (`budget_alert`, costo 0, R7-1) y los marcadores de charla del asistente (`assistant_event`, costo 0,
 * R9-2). No suman llamadas, tokens ni USD en los reportes.
 */
export const NOT_MODEL_CALLS = [
  "cv_reserve",
  LLM_RESERVE_TASK,
  "cv_start",
  "budget_alert",
  "assistant_event",
  "profile_read",
];

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

/**
 * Estimación en USD de un intento fallido del que no se sabe el costo (`cost_usd` null y `ok = false`:
 * red, timeout, 5xx; el proveedor pudo facturarlo). Cuando el proveedor informó el uso, el cliente
 * guarda el costo real y esto no se usa. Los topes en USD cuentan el intento con este valor: una
 * cuenta que provoca fallos a propósito ya no repite llamadas sin freno (R11-7). Cubre una llamada con
 * el tope de entrada (unos 25.000 tokens), más que una evaluación típica: lo conservador es frenar de más.
 * Solo se estima donde el proveedor pudo haber facturado sin informarlo: `timeout`, errores 5xx y
 * errores sin código. La sobrecarga del proveedor (503, 529, `overloaded`) tampoco se estima: casi nunca
 * se factura y una caída de minutos no debe agotar el tope. Un rechazo 4xx (clave inválida, crédito agotado, 429) no se factura y cuenta 0,
 * igual que un intento que nunca llegó al proveedor (`provider_unavailable`): si no, una caída o una
 * clave vencida agotaría el tope de 24 h sin gasto real.
 */
export const FAILED_CALL_ESTIMATE_USD = 0.04;

/** USD de una fila para los topes: el real si se conoce; si no, el estimado de un intento fallido. */
const billedUsd = sql`coalesce(${s.llmCalls.costUsd}, case when not ${s.llmCalls.ok} and (${s.llmCalls.error} is null or ${s.llmCalls.error} in ('timeout', 'api_call', 'unknown') or (${s.llmCalls.error} ~ '^api_call:5[0-9][0-9]$' and ${s.llmCalls.error} not in ('api_call:503', 'api_call:529'))) then ${FAILED_CALL_ESTIMATE_USD}::float8 end, 0)`;

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

/**
 * Consulta de la suma de gasto desde `since` (sin ejecutarla, para poder pedirle el plan). Con `userId`
 * entra por `llm_calls_user_task`; sin él, por `llm_calls_created`.
 */
export function spendSinceQuery(
  db: Pick<Db, "select">,
  since: Date,
  options: { userId?: string; excludeCvAgent?: boolean } = {},
) {
  return db
    .select({
      calls: sql<number>`count(*)::int`,
      failedCalls: sql<number>`count(*) filter (where not ${s.llmCalls.ok})::int`,
      unpricedCalls: sql<number>`count(*) filter (where ${s.llmCalls.ok} and ${s.llmCalls.costUsd} is null)::int`,
      tokensIn: sql<number>`coalesce(sum(${s.llmCalls.tokensIn}), 0)::int`,
      tokensOut: sql<number>`coalesce(sum(${s.llmCalls.tokensOut}), 0)::int`,
      tokensReasoning: sql<number>`coalesce(sum(${s.llmCalls.tokensReasoning}), 0)::int`,
      usd: sql<number>`coalesce(sum(${billedUsd}), 0)::float8`,
    })
    .from(s.llmCalls)
    .where(
      and(
        gte(s.llmCalls.createdAt, since),
        notInArray(
          s.llmCalls.task,
          options.excludeCvAgent
            ? [...NOT_MODEL_CALLS, ...PROFILE_AGENT_SPEND_TASKS]
            : NOT_MODEL_CALLS,
        ),
        options.userId ? eq(s.llmCalls.userId, options.userId) : undefined,
      ),
    );
}

/**
 * Con `userId` suma solo las llamadas de ese usuario; sin él, todas (tope global).
 * `excludeCvAgent` deja afuera las tareas del chat de CV y del agente de perfil: tienen su propio
 * presupuesto diario (global y por persona, `cv-chat/limits` y `profile-agent/limits`), así que no le
 * descuentan al tope global de evaluaciones, borradores y asistente (`LLM_DAILY_CAP_USD`). Úsese para
 * decidir ese tope; los reportes siguen sumando todo.
 */
export async function spendSince(
  db: Pick<Db, "select">,
  since: Date,
  options: { userId?: string; excludeCvAgent?: boolean } = {},
): Promise<SpendSummary> {
  const [row] = await spendSinceQuery(db, since, options);
  return { since, ...row! };
}

export const spendLast24h = (
  db: Pick<Db, "select">,
  now: () => Date = () => new Date(),
  options: { userId?: string; excludeCvAgent?: boolean } = {},
): Promise<SpendSummary> =>
  spendSince(db, new Date(now().getTime() - 24 * 60 * 60 * 1000), options);

/** Parte final del tope global que queda para quienes casi no gastaron. */
export const GLOBAL_CAP_RESERVED_SHARE = 0.2;
/** Hasta esta parte del tope global gastada por una persona, puede usar la parte reservada. */
export const GLOBAL_CAP_PERSON_FLOOR_SHARE = 0.05;

/**
 * ¿El tope global frena a esta persona? Al entrar en la parte reservada solo sigue quien casi no gastó,
 * así una persona no deja sin servicio a las demás. Un valor inválido frena; un tope en 0 no aplica.
 */
export function globalCapReached(input: {
  capUsd: number;
  totalUsd: number;
  mineUsd: number;
}): boolean {
  const { capUsd, totalUsd, mineUsd } = input;
  if (!(capUsd > 0)) return false;
  if (!Number.isFinite(totalUsd) || !Number.isFinite(mineUsd)) return true;
  if (totalUsd >= capUsd) return true;
  const inReservedPart = totalUsd >= capUsd * (1 - GLOBAL_CAP_RESERVED_SHARE);
  return inReservedPart && mineUsd >= capUsd * GLOBAL_CAP_PERSON_FLOOR_SHARE;
}

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
  const userCap = input.userDailyCapUsd ?? userDailyCapUsd();
  if (!(globalCap > 0) && !(userCap > 0)) return null;
  const mineUsd = (await spendLast24h(db, input.now, { userId: input.userId })).usd;
  if (globalCap > 0) {
    const totalUsd = (await spendLast24h(db, input.now, { excludeCvAgent: true })).usd;
    if (globalCapReached({ capUsd: globalCap, totalUsd, mineUsd })) return "global";
  }
  return userCap > 0 && mineUsd >= userCap ? "user" : null;
}

/**
 * Llamadas de una tarea que hizo un usuario desde `since`. Sirve para el tope de uso por persona,
 * por ejemplo 10 imágenes por día (R6-3). Con `onlyOk` cuenta solo las que respondieron (`ok`): una
 * llamada que falló en el transporte no consume el cupo (S2 de R6-3; el gasto lo cubre el tope en
 * USD). `db` tiene que ver `llm_calls` de todos (conexión de servicio). No exige migración: ya hay
 * `task`, `user_id`, `ok` y `created_at` en cada fila.
 */
export async function countTaskCallsSince(
  db: Db,
  input: { userId: string; task: string; since: Date; onlyOk?: boolean; onlyReached?: boolean },
): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(s.llmCalls)
    .where(
      and(
        eq(s.llmCalls.userId, input.userId),
        eq(s.llmCalls.task, input.task),
        gte(s.llmCalls.createdAt, input.since),
        ...(input.onlyOk ? [eq(s.llmCalls.ok, true)] : []),
        // `onlyReached` deja afuera el intento que nunca salió (primario sin clave): no se facturó
        ...(input.onlyReached
          ? [sql`${s.llmCalls.error} is distinct from 'provider_unavailable'`]
          : []),
      ),
    );
  return row?.n ?? 0;
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
      // Mismo criterio que los topes: el reporte no puede mostrar menos de lo que el tope contó
      usd: sql<number>`coalesce(sum(${billedUsd}), 0)::float8`,
    })
    .from(s.llmCalls)
    .where(and(gte(s.llmCalls.createdAt, since), notInArray(s.llmCalls.task, NOT_MODEL_CALLS)))
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
