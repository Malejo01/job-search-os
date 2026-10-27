import { schema as s, type Db } from "@job-search-os/db";
import { and, eq, gte, inArray, sql } from "drizzle-orm";

/**
 * Reservas de gasto del chat de CV (C-25, S-1). Los topes leen `llm_calls` antes de llamar al modelo y el
 * registro real se escribe después: dos pedidos en paralelo pasaban los dos. Sin locks que crucen
 * transacciones (no son seguros detrás del pooler en modo transacción):
 *  1. transacción corta con `pg_advisory_xact_lock` por persona: medir (contando las reservas vigentes) y,
 *     si pasa, insertar una fila de reserva; commit;
 *  2. la llamada al modelo va afuera de la transacción;
 *  3. otra transacción corta borra la reserva. La fila real la registra el cliente LLM.
 * Si el proceso muere, la reserva queda, pero los topes solo cuentan las de los últimos 2 minutos.
 *
 * Las filas `cv_reserve` y `cv_start` no suman USD: la reserva lleva `cost_usd` null y su estimado en
 * `tokens_out`, en millonésimas de USD; `cv_start` cuesta 0. `spend.ts` además las deja afuera de las
 * llamadas y los tokens.
 */
export const CV_RESERVE_TASK = "cv_reserve";
/** Cada `start` queda anotado (costo 0) para sostener el tope de charlas nuevas por día. */
export const CV_START_TASK = "cv_start";
export const CV_RESERVE_TTL_MS = 2 * 60 * 1000;
export const CV_RESERVE_LOCK_NAMESPACE = 26;
const MICRO_USD = 1_000_000;

export type CvChatStep = "interview" | "write";

export type CvChatMeasures = {
  cvThisMonth: number;
  /** Gasto de la charla: real más lo reservado. */
  conversationCostUsd: number;
  /** Gasto global de las tareas del chat en 24 h: real más lo reservado. */
  dailySpendUsd: number;
  writesInConversation: number;
  /** Gasto de entrevistas de la persona en 24 h (todas sus charlas): real más lo reservado. */
  userInterviewUsd: number;
  /** Charlas que la persona empezó en 24 h. */
  startsToday: number;
};

const CV_TASKS = ["cv_interview", "cv_write"];

export async function measureCvChat(
  q: Pick<Db, "select">,
  input: { userId: string; label: string; monthSince: Date; daySince: Date; now: Date },
): Promise<CvChatMeasures> {
  const c = s.llmCalls;
  const [month] = await q
    .select({ n: sql<number>`count(distinct ${c.label})::int` })
    .from(c)
    .where(
      and(
        eq(c.userId, input.userId),
        eq(c.task, "cv_write"),
        eq(c.ok, true),
        gte(c.createdAt, input.monthSince),
      ),
    );
  const [conv] = await q
    .select({
      usd: sql<number>`coalesce(sum(${c.costUsd}), 0)::float8`,
      writes: sql<number>`count(*) filter (where ${c.task} = 'cv_write' and ${c.ok})::int`,
    })
    .from(c)
    .where(and(eq(c.userId, input.userId), eq(c.label, input.label)));
  const [day] = await q
    .select({ usd: sql<number>`coalesce(sum(${c.costUsd}), 0)::float8` })
    .from(c)
    .where(and(inArray(c.task, CV_TASKS), gte(c.createdAt, input.daySince)));
  const [mine] = await q
    .select({
      usd: sql<number>`coalesce(sum(${c.costUsd}) filter (where ${c.task} = 'cv_interview'), 0)::float8`,
      starts: sql<number>`count(*) filter (where ${c.task} = ${CV_START_TASK})::int`,
    })
    .from(c)
    .where(and(eq(c.userId, input.userId), gte(c.createdAt, input.daySince)));
  const live = await q
    .select({
      userId: c.userId,
      step: c.model,
      label: c.label,
      micro: c.tokensOut,
    })
    .from(c)
    .where(
      and(
        eq(c.task, CV_RESERVE_TASK),
        gte(c.createdAt, new Date(input.now.getTime() - CV_RESERVE_TTL_MS)),
      ),
    );

  const usd = (rows: typeof live) => rows.reduce((t, r) => t + (r.micro ?? 0), 0) / MICRO_USD;
  const mineLive = live.filter((r) => r.userId === input.userId);
  const convLive = mineLive.filter((r) => r.label === input.label);
  const writeLabels = new Set(mineLive.filter((r) => r.step === "write").map((r) => r.label));
  return {
    cvThisMonth: (month?.n ?? 0) + writeLabels.size,
    conversationCostUsd: (conv?.usd ?? 0) + usd(convLive),
    dailySpendUsd: (day?.usd ?? 0) + usd(live),
    writesInConversation: (conv?.writes ?? 0) + (convLive.some((r) => r.step === "write") ? 1 : 0),
    userInterviewUsd: (mine?.usd ?? 0) + usd(mineLive.filter((r) => r.step === "interview")),
    startsToday: mine?.starts ?? 0,
  };
}

export type CvReservation<R> =
  | { ok: true; reservationId: string | null; measures: CvChatMeasures }
  | { ok: false; reject: R; measures: CvChatMeasures };

/**
 * Transacción corta con lock de la persona: mide, decide y, si pasa, anota. `step`:
 * - `interview` | `write`: inserta la reserva (`estimateUsd` es el máximo del paso) y devuelve su id;
 * - `start`: inserta la fila `cv_start` de costo 0 (así dos `start` en paralelo no pasan el tope de 5);
 * - `check`: solo mide y decide (acciones sin llamada al modelo).
 * `decide` devuelve el motivo de rechazo o `null`.
 */
export async function reserveCvChatStep<R>(
  db: Db,
  input: {
    userId: string;
    label: string;
    step: CvChatStep | "start" | "check";
    estimateUsd: number;
    now: Date;
    monthSince: Date;
    daySince: Date;
    decide: (m: CvChatMeasures) => R | null;
  },
): Promise<CvReservation<R>> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${input.userId}, ${CV_RESERVE_LOCK_NAMESPACE}))`,
    );
    const measures = await measureCvChat(tx, input);
    const reject = input.decide(measures);
    if (reject !== null) return { ok: false as const, reject, measures };
    if (input.step === "check") return { ok: true as const, reservationId: null, measures };
    const base = {
      userId: input.userId,
      promptVersion: `${input.step === "start" ? CV_START_TASK : CV_RESERVE_TASK}@v1`,
      jobId: null,
      tokensIn: null,
      tokensReasoning: null,
      latencyMs: 0,
      label: input.label,
      ok: true,
      error: null,
    };
    if (input.step === "start") {
      await tx
        .insert(s.llmCalls)
        .values({ ...base, task: CV_START_TASK, model: "none", tokensOut: 0, costUsd: 0 });
      return { ok: true as const, reservationId: null, measures };
    }
    const [row] = await tx
      .insert(s.llmCalls)
      .values({
        ...base,
        task: CV_RESERVE_TASK,
        model: input.step,
        tokensOut: Math.max(0, Math.round(input.estimateUsd * MICRO_USD)),
        costUsd: null,
      })
      .returning({ id: s.llmCalls.id });
    return { ok: true as const, reservationId: row?.id ?? null, measures };
  });
}

/** Borra la reserva (otra transacción corta). Idempotente. */
export async function releaseCvChatReservation(
  db: Db,
  reservationId: string | null,
): Promise<void> {
  if (!reservationId) return;
  await db
    .delete(s.llmCalls)
    .where(and(eq(s.llmCalls.id, reservationId), eq(s.llmCalls.task, CV_RESERVE_TASK)));
}
