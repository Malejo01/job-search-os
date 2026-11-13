import { schema as s, type Db } from "@job-search-os/db";
import {
  CV_CHAT_TURN_RESERVE_USD,
  CV_CHAT_WRITE_RESERVE_USD,
  PROFILE_AGENT_READ_RESERVE_USD,
  profileAgentCapReason,
  type ProfileAgentCap,
} from "@job-search-os/pipeline";
import { and, eq, gte, sql } from "drizzle-orm";
import { CV_RESERVE_TASK, CV_RESERVE_TTL_MS } from "../../cv-chat/reserve";

/**
 * Cupo y reserva de la lectura del CV del agente de perfil (ADR-034 §6). Mismo patrón que el chat de CV
 * (`cv-chat/reserve.ts`, S-1): una transacción corta con `pg_advisory_xact_lock` por persona (no locks de
 * sesión: el pooler de Neon no los sostiene) que mide, decide e inserta la reserva; la llamada al modelo va
 * afuera; otra transacción corta borra la reserva. Todo falla cerrado.
 *
 * - **Cupo mensual:** filas marcador `profile_read` (costo 0, modelo `none`, `label = cv:<flowId>`) que se
 *   insertan SOLO cuando la propuesta pasó la normalización. Una lectura que da `timeout`, `aborted`,
 *   `llm_failed`, `output_invalid` o `sensitive_output` no deja marcador y no consume cupo (#162). Sin
 *   migración.
 * - **Gasto (O1):** las llamadas fallidas llegan con `cost_usd` null: los topes de USD suman
 *   `coalesce(cost_usd, <estimado del paso>)`, el espejo en SQL de `profileAgentRowCostUsd`.
 * - **Una lectura a la vez por persona:** la reserva vigente (2 minutos) con `model = 'read'` reemplaza al
 *   registro en memoria de `extract.ts`, que no cubría dos instancias.
 *
 * Las filas `cv_reserve` y `profile_read` no suman USD en los reportes (`spend.ts` deja afuera
 * `cv_reserve`; `profile_read` cuesta 0).
 */
export const PROFILE_READ_TASK = "profile_read";
/** Namespace propio del lock por persona de este flujo (el chat de CV usa 26). */
export const PROFILE_AGENT_LOCK_NAMESPACE = 34;
/** Tarea de la lectura (`model_routing`). Se repite acá para no importar `cv/extract` en la consulta. */
const EXTRACT_TASK = "extract_cv_profile";
/** Tareas del agente que gastan: la lectura y las dos del chat que reusa (`cv_interview`, `cv_write`). */
const AGENT_TASKS = [EXTRACT_TASK, "cv_interview", "cv_write"] as const;
const MICRO_USD = 1_000_000;

export type ProfileReadMeasures = {
  /** Lecturas completas (marcador) en la ventana mensual. */
  readsThisMonth: number;
  /** Intentos de lectura en 24 h, también los que fallaron (pueden haber costado). */
  readsToday: number;
  /** Gasto de la persona en 24 h en las tareas del agente: real o estimado, más lo reservado. */
  userSpendTodayUsd: number;
  /** Gasto global de las tareas del agente en 24 h: real o estimado, más lo reservado. */
  dailySpendUsd: number;
  /** Hay una lectura reservada y vigente de esta persona. */
  readInFlight: boolean;
};

const attempted = (c: typeof s.llmCalls) => sql`${c.error} is distinct from 'provider_unavailable'`;

/**
 * Espejo en SQL de `profileAgentRowCostUsd`: el costo real si se conoce; si no, el máximo del paso. Una
 * llamada que nunca salió (`provider_unavailable`) vale 0.
 */
const billedUsd = (c: typeof s.llmCalls) =>
  sql`coalesce(${c.costUsd}, case when ${attempted(c)} then (case ${c.task} when 'cv_write' then ${CV_CHAT_WRITE_RESERVE_USD}::float8 when 'cv_interview' then ${CV_CHAT_TURN_RESERVE_USD}::float8 else ${PROFILE_AGENT_READ_RESERVE_USD}::float8 end) else 0 end)`;

const AGENT_TASKS_SQL = sql.join(
  AGENT_TASKS.map((t) => sql`${t}`),
  sql`, `,
);

export async function measureProfileRead(
  q: Pick<Db, "select">,
  input: { userId: string; monthSince: Date; daySince: Date; now: Date },
): Promise<ProfileReadMeasures> {
  const c = s.llmCalls;
  const [month] = await q
    .select({ n: sql<number>`count(*)::int` })
    .from(c)
    .where(
      and(
        eq(c.userId, input.userId),
        eq(c.task, PROFILE_READ_TASK),
        gte(c.createdAt, input.monthSince),
      ),
    );
  const [reads] = await q
    .select({ n: sql<number>`count(*)::int` })
    .from(c)
    .where(
      and(
        eq(c.userId, input.userId),
        eq(c.task, EXTRACT_TASK),
        attempted(c),
        gte(c.createdAt, input.daySince),
      ),
    );
  const [day] = await q
    .select({
      all: sql<number>`coalesce(sum(${billedUsd(c)}), 0)::float8`,
      mine: sql<number>`coalesce(sum(${billedUsd(c)}) filter (where ${c.userId} = ${input.userId}), 0)::float8`,
    })
    .from(c)
    .where(and(sql`${c.task} in (${AGENT_TASKS_SQL})`, gte(c.createdAt, input.daySince)));
  const live = await q
    .select({ userId: c.userId, step: c.model, micro: c.tokensOut })
    .from(c)
    .where(
      and(
        eq(c.task, CV_RESERVE_TASK),
        gte(c.createdAt, new Date(input.now.getTime() - CV_RESERVE_TTL_MS)),
      ),
    );
  const usd = (rows: typeof live) => rows.reduce((t, r) => t + (r.micro ?? 0), 0) / MICRO_USD;
  const mine = live.filter((r) => r.userId === input.userId);
  return {
    readsThisMonth: month?.n ?? 0,
    readsToday: (reads?.n ?? 0) + mine.filter((r) => r.step === "read").length,
    userSpendTodayUsd: (day?.mine ?? 0) + usd(mine),
    dailySpendUsd: (day?.all ?? 0) + usd(live),
    readInFlight: mine.some((r) => r.step === "read"),
  };
}

export type ProfileReadReject = ProfileAgentCap | "in_progress";

export type ProfileReadReservation =
  | { ok: true; reservationId: string; measures: ProfileReadMeasures }
  | { ok: false; reject: ProfileReadReject; measures: ProfileReadMeasures };

/**
 * Mide, decide y, si pasa, anota la reserva de la lectura. Un exento (`exempt`) no tiene tope de lecturas
 * por mes ni por día, pero los topes de USD (persona, día y global) rigen igual: ningún camino los saltea.
 */
export async function reserveProfileRead(
  db: Db,
  input: {
    userId: string;
    label: string;
    now: Date;
    monthSince: Date;
    daySince: Date;
    exempt: boolean;
    readsPerMonth: number;
    dailyCapUsd: number;
  },
): Promise<ProfileReadReservation> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${input.userId}, ${PROFILE_AGENT_LOCK_NAMESPACE}))`,
    );
    const measures = await measureProfileRead(tx, input);
    if (measures.readInFlight)
      return { ok: false as const, reject: "in_progress" as const, measures };
    const cap = profileAgentCapReason({
      stage: "read",
      exempt: input.exempt,
      readsThisMonth: measures.readsThisMonth,
      readsPerMonth: input.readsPerMonth,
      readsToday: measures.readsToday,
      gapTurns: 0,
      flowCostUsd: 0,
      userSpendTodayUsd: measures.userSpendTodayUsd,
      dailySpendUsd: measures.dailySpendUsd,
      dailyCapUsd: input.dailyCapUsd,
    });
    if (cap !== null) return { ok: false as const, reject: cap, measures };
    const [row] = await tx
      .insert(s.llmCalls)
      .values({
        userId: input.userId,
        task: CV_RESERVE_TASK,
        model: "read",
        promptVersion: `${CV_RESERVE_TASK}@v1`,
        jobId: null,
        tokensIn: null,
        tokensOut: Math.max(0, Math.round(PROFILE_AGENT_READ_RESERVE_USD * MICRO_USD)),
        tokensReasoning: null,
        latencyMs: 0,
        costUsd: null,
        label: input.label,
        ok: true,
        error: null,
      })
      .returning({ id: s.llmCalls.id });
    // Sin id no hay forma de soltarla: falla cerrado (la reserva ya anotada vence sola a los 2 minutos)
    if (!row) throw new Error("reserva sin id");
    return { ok: true as const, reservationId: row.id, measures };
  });
}

/** Anota la lectura completa: es lo que consume cupo. Se llama SOLO con la propuesta ya normalizada. */
export async function recordProfileRead(
  db: Db,
  input: { userId: string; label: string },
): Promise<void> {
  await db.insert(s.llmCalls).values({
    userId: input.userId,
    task: PROFILE_READ_TASK,
    model: "none",
    promptVersion: `${PROFILE_READ_TASK}@v1`,
    jobId: null,
    tokensIn: null,
    tokensOut: 0,
    tokensReasoning: null,
    latencyMs: 0,
    costUsd: 0,
    label: input.label,
    ok: true,
    error: null,
  });
}
