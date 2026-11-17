/**
 * Topes de la redacción del CV en el cierre (ADR-034 §6, R10-5). Puro: el llamador mide y pasa los
 * números. Falla cerrado: un número ausente, negativo o no finito cuenta como tope alcanzado.
 * Reusa `profileAgentCapReason` (charla, persona-día y global) y suma los dos topes propios del paso:
 * una redacción por charla y el cupo de «CV por mes» del chat (ADR-034 §6, fila «Redacción del CV»).
 */
import {
  profileAgentCapReason,
  profileAgentCapNotice,
  type ProfileAgentCap,
  type ProfileAgentCapNotice,
} from "../limits";

/** Intentos de redacción por charla: el primero y un reintento si el primero falló (R11-2). */
export const PROFILE_AGENT_MAX_WRITE_ATTEMPTS = 2;

export type ProfileAgentWriteReject = ProfileAgentCap | "cv_mes" | "already_written";

export interface ProfileAgentWriteCapInput {
  /** Gasto de esta charla (real, con las fallidas al estimado, más lo reservado). */
  flowCostUsd: number;
  /** Gasto de esta persona en las últimas 24 h, de todas sus charlas. */
  userSpendTodayUsd: number;
  /** Gasto global del agente en las últimas 24 h. */
  dailySpendUsd: number;
  dailyCapUsd: number;
  /** Intentos de redacción de esta charla (los que llegaron al modelo, bien o mal, y la reserva vigente). */
  writesInFlow: number;
  /** Redacciones de esta charla que terminaron bien: una lograda no se repite. */
  okWritesInFlow: number;
  /** Hay una redacción de esta charla en curso: no se pisa con otra en paralelo. */
  writeInFlight: boolean;
  /** Charlas con redacción de esta persona en la ventana mensual. */
  cvThisMonth: number;
  cvPerMonth: number;
}

export function profileAgentWriteReject(
  i: ProfileAgentWriteCapInput,
): ProfileAgentWriteReject | null {
  const cap = profileAgentCapReason({
    stage: "write",
    // Las lecturas no se cuentan acá: el cupo de lecturas es de la etapa de lectura
    exempt: true,
    readsThisMonth: 0,
    readsPerMonth: 1,
    readsToday: 0,
    gapTurns: 0,
    flowCostUsd: i.flowCostUsd,
    userSpendTodayUsd: i.userSpendTodayUsd,
    dailySpendUsd: i.dailySpendUsd,
    dailyCapUsd: i.dailyCapUsd,
  });
  if (cap) return cap;
  // Una redacción lograda no se repite; una que falló se puede reintentar UNA vez (R11-2), sin pisar otra en curso
  if (i.writeInFlight !== false) return "already_written";
  if (!(i.okWritesInFlow < 1)) return "already_written";
  if (!(i.writesInFlow < PROFILE_AGENT_MAX_WRITE_ATTEMPTS)) return "already_written";
  if (!(i.cvThisMonth < i.cvPerMonth)) return "cv_mes";
  return null;
}

export type ProfileAgentWriteNotice = ProfileAgentCapNotice & { code: ProfileAgentWriteReject };

const CV_MES_MESSAGE =
  "Llegaste al tope de CV armados con IA de este mes. Podés completar tu perfil a mano desde las pantallas y volver el mes que viene.";
const ALREADY_WRITTEN_MESSAGE = "Este CV ya se redactó en esta charla. Revisalo y confirmalo.";

/** Mensaje fijo con los links a las pantallas manuales: nunca depende del modelo. */
export function profileAgentWriteNotice(reject: ProfileAgentWriteReject): ProfileAgentWriteNotice {
  if (reject === "cv_mes" || reject === "already_written") {
    const base = profileAgentCapNotice("usuario");
    return {
      code: reject,
      message: reject === "cv_mes" ? CV_MES_MESSAGE : ALREADY_WRITTEN_MESSAGE,
      links: base.links,
    };
  }
  return { code: reject, ...profileAgentCapNotice(reject) };
}
