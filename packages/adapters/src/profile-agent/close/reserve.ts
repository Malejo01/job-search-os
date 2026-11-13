/**
 * Reserva y topes de la redacción del cierre (ADR-034 §6, R10-5). Reusa `reserveCvChatStep` (paso `write`,
 * lock por persona, fila de reserva de 2 minutos) y decide con `profileAgentWriteReject` (pipeline).
 *
 * El gasto cuenta las llamadas fallidas (O1): `cost_usd` null de una fila fallida vale el estimado del paso
 * (`measureCvChat` ya lo hace para `cv_interview` y `cv_write`; `measureProfileAgentUserSpendUsd` lo hace
 * para las tres tareas del agente). Los topes por charla y global se miden dentro del lock; el de persona
 * y día se mide justo antes (otra consulta, fuera del lock: una redacción por charla ya está acotada por
 * `already_written` bajo el lock).
 */
import { schema as s, type Db } from "@job-search-os/db";
import {
  CV_CHAT_TURN_RESERVE_USD,
  CV_CHAT_WRITE_RESERVE_USD,
  PROFILE_AGENT_READ_RESERVE_USD,
  cvChatBetaCvPerMonth,
  cvChatWindows,
  profileAgentDailyCapUsd,
  profileAgentWriteReject,
  type ProfileAgentWriteReject,
} from "@job-search-os/pipeline";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { cvChatLabel } from "../../cv-chat/ids";
import { reserveCvChatStep, type CvReservation } from "../../cv-chat/reserve";

export const PROFILE_AGENT_CLOSE_SPEND_TASKS = [
  "extract_cv_profile",
  "cv_interview",
  "cv_write",
] as const;

/**
 * Gasto de la persona en las últimas 24 h con las tres tareas del agente. Una fila fallida llega con
 * `cost_usd` null y cuenta como el estimado de su paso; `provider_unavailable` (nunca se llamó) no cuenta.
 */
export async function measureProfileAgentUserSpendUsd(
  q: Pick<Db, "select">,
  input: { userId: string; daySince: Date },
): Promise<number> {
  const c = s.llmCalls;
  const estimate = sql`(case ${c.task} when 'extract_cv_profile' then ${PROFILE_AGENT_READ_RESERVE_USD}::float8 when 'cv_write' then ${CV_CHAT_WRITE_RESERVE_USD}::float8 else ${CV_CHAT_TURN_RESERVE_USD}::float8 end)`;
  const [row] = await q
    .select({
      usd: sql<number>`coalesce(sum(case when ${c.costUsd} is not null and ${c.costUsd} >= 0 then ${c.costUsd} when ${c.ok} = false and ${c.error} is distinct from 'provider_unavailable' then ${estimate} else 0 end), 0)::float8`,
    })
    .from(c)
    .where(
      and(
        eq(c.userId, input.userId),
        inArray(c.task, [...PROFILE_AGENT_CLOSE_SPEND_TASKS]),
        gte(c.createdAt, input.daySince),
      ),
    );
  return row?.usd ?? 0;
}

/**
 * Anota un intento de redacción fallido (`ok = false`, costo null) cuando la llamada lanzó antes de que el
 * cliente LLM registrara su fila. Así el intento cuenta para «una redacción por charla» y para el gasto
 * (estimado del paso) aunque se libere la reserva. Nunca guarda texto.
 */
export async function recordProfileAgentWriteFailure(
  db: Db,
  p: { userId: string; flowId: string },
): Promise<void> {
  await db.insert(s.llmCalls).values({
    userId: p.userId,
    task: "cv_write",
    model: "none",
    ok: false,
    costUsd: null,
    error: "exception",
    label: cvChatLabel(p.flowId),
  });
}

export type ProfileAgentWriteSlotParams = {
  userId: string;
  flowId: string;
  now: Date;
  /** `plan.limits.cvReadsPerMonth` del plan vigente; el cupo de CV por mes toma el mínimo de la beta. */
  planCvPerMonth: number;
  env: Record<string, string | undefined>;
  /** Sin trabajos no hay llamada al modelo: solo se mide (paso `check`), sin reserva. */
  callsModel: boolean;
};

/**
 * Mide, decide y, si pasa y hay llamada, anota la reserva. `reservationId` se suelta con
 * `releaseCvChatReservation` en un `finally`, después de la llamada.
 */
export async function reserveProfileAgentWrite(
  db: Db,
  p: ProfileAgentWriteSlotParams,
): Promise<CvReservation<ProfileAgentWriteReject>> {
  const { monthSince, daySince } = cvChatWindows(p.now);
  const userSpendTodayUsd = await measureProfileAgentUserSpendUsd(db, {
    userId: p.userId,
    daySince,
  });
  return reserveCvChatStep<ProfileAgentWriteReject>(db, {
    userId: p.userId,
    label: cvChatLabel(p.flowId),
    step: p.callsModel ? "write" : "check",
    estimateUsd: CV_CHAT_WRITE_RESERVE_USD,
    now: p.now,
    monthSince,
    daySince,
    decide: (m) =>
      profileAgentWriteReject({
        flowCostUsd: m.conversationCostUsd,
        userSpendTodayUsd,
        dailySpendUsd: m.dailySpendUsd,
        dailyCapUsd: profileAgentDailyCapUsd(p.env),
        writesInFlow: m.writesInConversation,
        cvThisMonth: m.cvThisMonth,
        cvPerMonth: cvChatBetaCvPerMonth(p.planCvPerMonth),
      }),
  });
}
