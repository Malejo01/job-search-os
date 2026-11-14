/**
 * Reserva y topes de la redacción del cierre (ADR-034 §6, R10-5). Reusa `reserveCvChatStep` (paso `write`,
 * lock por persona, fila de reserva de 2 minutos) y decide con `profileAgentWriteReject` (pipeline).
 *
 * El gasto cuenta las llamadas fallidas (O1): `cost_usd` null de una fila fallida vale el estimado del paso
 * (`measureCvChat` ya lo hace para `cv_interview` y `cv_write`; `measureProfileAgentUserSpendUsd` lo hace
 * para las tres tareas del agente). Los topes por charla, global y por persona y día se miden dentro del
 * lock (R11-2; antes el de persona y día se medía justo antes, fuera del lock).
 * Una redacción que falló se puede reintentar una vez (`PROFILE_AGENT_MAX_WRITE_ATTEMPTS`); una lograda no.
 */
import { schema as s, type Db } from "@job-search-os/db";
import {
  CV_CHAT_WRITE_RESERVE_USD,
  cvChatBetaCvPerMonth,
  cvChatWindows,
  profileAgentDailyCapUsd,
  profileAgentWriteReject,
  type ProfileAgentWriteReject,
} from "@job-search-os/pipeline";
import { cvChatLabel } from "../../cv-chat/ids";
import { reserveCvChatStep, type CvReservation } from "../../cv-chat/reserve";
import { PROFILE_AGENT_SPEND_TASKS, measureProfileAgentSpend } from "../measure";

export const PROFILE_AGENT_CLOSE_SPEND_TASKS = PROFILE_AGENT_SPEND_TASKS;

/**
 * Gasto de la persona en las últimas 24 h con las tres tareas del agente. Es la medición compartida
 * (`../measure`): una fila fallida llega con `cost_usd` null y cuenta como el estimado de su paso;
 * `provider_unavailable` (nunca se llamó) no cuenta.
 */
export async function measureProfileAgentUserSpendUsd(
  q: Pick<Db, "select">,
  input: { userId: string; daySince: Date },
): Promise<number> {
  return (await measureProfileAgentSpend(q, input)).userUsd;
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
  // El tope por persona y día se mide DENTRO del lock (R11-2, `m.agentUserSpendUsd`): antes se medía
  // justo antes y dos pedidos de charlas distintas podían pasar los dos
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
        userSpendTodayUsd: m.agentUserSpendUsd,
        dailySpendUsd: m.dailySpendUsd,
        dailyCapUsd: profileAgentDailyCapUsd(p.env),
        writesInFlow: m.writesInConversation,
        okWritesInFlow: m.okWritesInConversation,
        writeInFlight: m.writeInFlight,
        cvThisMonth: m.cvThisMonth,
        cvPerMonth: cvChatBetaCvPerMonth(p.planCvPerMonth),
      }),
  });
}
