import { schema as s, type Db } from "@job-search-os/db";
import {
  CV_CHAT_TURN_RESERVE_USD,
  CV_COACH_RESERVE_USD,
  cvCoachCapReason,
  profileAgentCapReason,
  type CvCoachCap,
  type ProfileAgentCap,
} from "@job-search-os/pipeline";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { CV_RESERVE_LOCK_NAMESPACE, CV_RESERVE_TASK, CV_RESERVE_TTL_MS } from "../cv-chat/reserve";
import {
  measureProfileAgentSpend,
  profileAgentAttempted,
  reservedUsd,
} from "../profile-agent/measure";

/**
 * Medidas y reservas del coach de CV (ADR-038 §9, D5). Mismo patrón que el chat de CV y el agente de perfil
 * (`cv-chat/reserve.ts`, `profile-agent/gaps/reserve.ts`): una transacción corta con
 * `pg_advisory_xact_lock` por persona mide, decide y anota la reserva; la llamada al modelo va afuera; otra
 * transacción corta la borra bajo el mismo lock (`releaseCvCoachReservation`). El lock es el del chat de CV (26), el mismo que
 * toma la redacción del cierre (`reserveCvChatStep`): un turno del coach y la redacción de la misma persona
 * no se cruzan.
 *
 * - **Por charla** (`label = cv:<flowId>`, el ticket del agente de perfil): turnos (`cv_coach_turn`),
 *   diagnósticos (`cv_review`), gasto de TODAS las tareas de la charla (lectura, diagnóstico, turnos,
 *   redacción) y si ya hubo una redacción lograda. Los cuenta `llm_calls`, nunca el navegador.
 * - **Gasto (O1 de ADR-034):** una llamada que llegó al proveedor cuenta aunque haya fallado; con
 *   `cost_usd` null (o inválido) vale la reserva de su paso. Solo `provider_unavailable` vale 0.
 * - **Persona-día y global:** los del agente de perfil, compartidos (`measureProfileAgentSpend`), más el
 *   gasto de las dos tareas del coach, que esa medición todavía no incluye.
 * - Decide con `cvCoachCapReason` (turnos, diagnósticos y la charla con la redacción reservada) y
 *   `profileAgentCapReason` (persona-día y global). Todo falla cerrado.
 */
export const CV_REVIEW_TASK = "cv_review";
export const CV_COACH_TURN_TASK = "cv_coach_turn";
export const CV_COACH_TASKS = [CV_REVIEW_TASK, CV_COACH_TURN_TASK] as const;

/** Pasos del coach que llaman al modelo. La redacción reusa la reserva del cierre de ADR-034. */
export type CvCoachReserveStep = "review" | "turn";

/** Valor de `llm_calls.model` en la fila de reserva de cada paso (así se distinguen las vivas). */
const RESERVE_MODEL: Record<CvCoachReserveStep, string> = {
  review: "coach_review",
  turn: "coach_turn",
};
const MICRO_USD = 1_000_000;

const attempted = profileAgentAttempted;

/**
 * Costo de una fila de la charla: el real si es válido (0 o más, finito); si no, la reserva de su paso.
 * Las filas sin costo propio (`cv_reserve`, `cv_start`, `profile_read`) valen 0: las reservas vivas se
 * suman aparte. Espejo en SQL de `profileAgentRowCostUsd`.
 */
const coachBilledUsd = (c: typeof s.llmCalls) =>
  sql`case when ${c.task} in ('extract_cv_profile', 'cv_interview', 'cv_write', 'cv_review', 'cv_coach_turn') and ${attempted(c)} then (case when ${c.costUsd}::float8 between 0 and 'Infinity'::float8 then ${c.costUsd}::float8 when ${c.task} = 'extract_cv_profile' then ${CV_COACH_RESERVE_USD.read}::float8 when ${c.task} = 'cv_write' then ${CV_COACH_RESERVE_USD.write}::float8 when ${c.task} = 'cv_review' then ${CV_COACH_RESERVE_USD.review}::float8 when ${c.task} = 'cv_coach_turn' then ${CV_COACH_RESERVE_USD.turn}::float8 else ${CV_CHAT_TURN_RESERVE_USD}::float8 end) else 0 end`;

export type CvCoachMeasures = {
  /** Llamadas a `cv_coach_turn` de esta charla (también las fallidas) más las reservas vivas de turno. */
  turns: number;
  /** Llamadas a `cv_review` de esta charla más las reservas vivas de diagnóstico. */
  reviews: number;
  /** Gasto de esta charla, todas las tareas: real o reserva del paso, más lo reservado. */
  flowCostUsd: number;
  /** Hubo una redacción lograda (`cv_write` con `ok = true`) en esta charla. */
  written: boolean;
  /** Gasto de la persona en 24 h (agente de perfil + coach), más lo reservado. */
  userSpendTodayUsd: number;
  /** Gasto global en 24 h (agente de perfil + coach), más lo reservado. */
  dailySpendUsd: number;
};

export async function measureCvCoach(
  q: Pick<Db, "select">,
  input: { userId: string; label: string; daySince: Date; now: Date },
): Promise<CvCoachMeasures> {
  const c = s.llmCalls;
  const [flow] = await q
    .select({
      turns: sql<number>`count(*) filter (where ${c.task} = ${CV_COACH_TURN_TASK} and ${attempted(c)})::int`,
      reviews: sql<number>`count(*) filter (where ${c.task} = ${CV_REVIEW_TASK} and ${attempted(c)})::int`,
      writes: sql<number>`count(*) filter (where ${c.task} = 'cv_write' and ${c.ok} = true)::int`,
      usd: sql<number>`coalesce(sum(${coachBilledUsd(c)}), 0)::float8`,
    })
    .from(c)
    .where(and(eq(c.userId, input.userId), eq(c.label, input.label)));
  // Persona-día y global: la medición compartida del agente más las dos tareas del coach
  const agent = await measureProfileAgentSpend(q, input);
  const [coach] = await q
    .select({
      all: sql<number>`coalesce(sum(${coachBilledUsd(c)}), 0)::float8`,
      mine: sql<number>`coalesce(sum(${coachBilledUsd(c)}) filter (where ${c.userId} = ${input.userId}), 0)::float8`,
    })
    .from(c)
    .where(and(inArray(c.task, [...CV_COACH_TASKS]), gte(c.createdAt, input.daySince)));
  const live = await q
    .select({ userId: c.userId, label: c.label, micro: c.tokensOut, step: c.model })
    .from(c)
    .where(
      and(
        eq(c.task, CV_RESERVE_TASK),
        gte(c.createdAt, new Date(input.now.getTime() - CV_RESERVE_TTL_MS)),
      ),
    );
  const mineLive = live.filter((r) => r.userId === input.userId);
  const flowLive = mineLive.filter((r) => r.label === input.label);
  return {
    turns: (flow?.turns ?? 0) + flowLive.filter((r) => r.step === RESERVE_MODEL.turn).length,
    reviews: (flow?.reviews ?? 0) + flowLive.filter((r) => r.step === RESERVE_MODEL.review).length,
    flowCostUsd: (flow?.usd ?? 0) + reservedUsd(flowLive),
    written: (flow?.writes ?? 0) > 0,
    userSpendTodayUsd: agent.userUsd + (coach?.mine ?? 0) + reservedUsd(mineLive),
    dailySpendUsd: agent.dailyUsd + (coach?.all ?? 0) + reservedUsd(live),
  };
}

/** Por qué no se hace el paso: un tope propio del coach o uno compartido del agente de perfil. */
export type CvCoachReject = CvCoachCap | ProfileAgentCap;

/** Decisión pura sobre las medidas. Primero los topes del coach; después persona-día y global. */
export function decideCvCoachStep(
  step: CvCoachReserveStep,
  m: CvCoachMeasures,
  dailyCapUsd: number,
): CvCoachReject | null {
  const own = cvCoachCapReason({
    step,
    turns: m.turns,
    reviews: m.reviews,
    flowCostUsd: m.flowCostUsd,
    written: m.written,
  });
  if (own !== null) return own;
  return profileAgentCapReason({
    // solo rigen la charla, persona-día y global: la lectura y los turnos de huecos no se miden acá
    stage: "gaps",
    exempt: false,
    readsThisMonth: 0,
    readsPerMonth: 1,
    readsToday: 0,
    gapTurns: 0,
    flowCostUsd: m.flowCostUsd,
    userSpendTodayUsd: m.userSpendTodayUsd,
    dailySpendUsd: m.dailySpendUsd,
    dailyCapUsd,
  });
}

export type CvCoachReservation =
  | { ok: true; reservationId: string; measures: CvCoachMeasures }
  | { ok: false; reject: CvCoachReject; measures: CvCoachMeasures };

/**
 * Transacción corta con lock de la persona: mide, decide y, si pasa, anota la reserva del paso (el máximo
 * del paso, `CV_COACH_RESERVE_USD`). El id se suelta con `releaseCvCoachReservation` en un `finally`,
 * después de la llamada. Los topes de USD valen para todos: no hay parámetro de exención.
 */
export async function reserveCvCoachStep(
  db: Db,
  input: {
    userId: string;
    label: string;
    step: CvCoachReserveStep;
    now: Date;
    daySince: Date;
    dailyCapUsd: number;
  },
): Promise<CvCoachReservation> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${input.userId}, ${CV_RESERVE_LOCK_NAMESPACE}))`,
    );
    const measures = await measureCvCoach(tx, input);
    const reject = decideCvCoachStep(input.step, measures, input.dailyCapUsd);
    if (reject !== null) return { ok: false as const, reject, measures };
    const [row] = await tx
      .insert(s.llmCalls)
      .values({
        userId: input.userId,
        task: CV_RESERVE_TASK,
        model: RESERVE_MODEL[input.step],
        promptVersion: `${CV_RESERVE_TASK}@v1`,
        jobId: null,
        tokensIn: null,
        tokensOut: Math.max(0, Math.round(CV_COACH_RESERVE_USD[input.step] * MICRO_USD)),
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

/**
 * Suelta la reserva **bajo el mismo lock** con el que se reservó (R12-16). La medición son varias consultas
 * y, en READ COMMITTED, cada una ve su propia foto: si la reserva se borrara sin lock mientras otro pedido de
 * la misma persona mide, ese pedido podría no ver ni la reserva (ya borrada) ni la fila real del cliente LLM
 * (en una consulta anterior todavía no estaba) y dejar pasar un paso de más. Con el lock, el borrado espera
 * a que termine quien está midiendo.
 *
 * Idempotente. Nunca lanza: se llama en un `finally` y un error acá no puede tapar el resultado del paso.
 * Devuelve `false` si falló, para que el llamador lo loguee; la reserva que quede vence a los 2 minutos.
 */
export async function releaseCvCoachReservation(
  db: Db,
  input: { userId: string; reservationId: string | null },
): Promise<boolean> {
  if (!input.reservationId) return true;
  const id = input.reservationId;
  try {
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${input.userId}, ${CV_RESERVE_LOCK_NAMESPACE}))`,
      );
      await tx
        .delete(s.llmCalls)
        .where(
          and(
            eq(s.llmCalls.id, id),
            eq(s.llmCalls.userId, input.userId),
            eq(s.llmCalls.task, CV_RESERVE_TASK),
          ),
        );
    });
    return true;
  } catch {
    return false;
  }
}
