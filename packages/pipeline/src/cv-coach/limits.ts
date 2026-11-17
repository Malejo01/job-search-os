/**
 * Topes del coach de CV (ADR-038 §9, D5). Puro: el llamador mide en `llm_calls` (por `label = cv:<flowId>`,
 * con `COALESCE(cost_usd, <reserva del paso>)` como en ADR-034 §6 O1) y pasa los números; acá solo se
 * decide. Todo falla cerrado: un número ausente, negativo o no finito cuenta como tope alcanzado. Los
 * mensajes son fijos, con links a las pantallas manuales: nunca texto del modelo.
 *
 * Los topes por persona y día y el global son los del agente de perfil (compartidos): el coach los pasa por
 * `profileAgentCapReason`. Acá van los propios de la charla del coach.
 */
import { PROFILE_AGENT_READ_RESERVE_USD } from "../profile-agent/limits";

/** Gasto real máximo de una charla del coach: lectura, diagnóstico, turnos y redacción (D5). */
export const CV_COACH_MAX_FLOW_COST_USD = 0.3;
/** Llamadas a `cv_coach_turn` por charla (D5). */
export const CV_COACH_MAX_TURNS = 15;
/** Llamadas a `cv_review` por charla: una y un reintento si falla. */
export const CV_COACH_MAX_REVIEWS = 2;
/** Respuestas ilegibles por problema antes de saltearlo (como `CV_CHAT_MAX_FAILURES`). */
export const CV_COACH_MAX_FAILURES_PER_ISSUE = 2;
/** Repreguntas del modelo por problema (como `CV_FOLLOWUP_MAX`). */
export const CV_COACH_MAX_FOLLOW_UPS = 2;

/**
 * Reservas (máximo del paso, no el promedio). R12-8 y R12-9 las recalculan con las filas reales de
 * `model_routing` en un test de adapters (reserva entre 1 y 1,25 veces el máximo) y las ajustan acá.
 */
export const CV_COACH_RESERVE_USD = {
  read: PROFILE_AGENT_READ_RESERVE_USD,
  review: 0.05,
  turn: 0.04,
  /** La de la redacción del chat de CV (`cv_write`, ADR-026 §6). */
  write: 0.07,
} as const;
export type CvCoachStep = keyof typeof CV_COACH_RESERVE_USD;

export type CvCoachCap = "turnos" | "diagnosticos" | "charla";

export interface CvCoachCapInput {
  /** Paso que se quiere hacer. La lectura pasa por los topes del agente de perfil, no por acá. */
  step: Exclude<CvCoachStep, "read">;
  /** Llamadas `cv_coach_turn` de esta charla (por `label`, no por lo que diga el navegador). */
  turns: number;
  /** Llamadas `cv_review` de esta charla. */
  reviews: number;
  /** Gasto de esta charla, todas las tareas (suma con `COALESCE` a la reserva del paso). */
  flowCostUsd: number;
  /** ¿Ya se redactó el CV en esta charla? Si sí, no hay que reservarlo. */
  written: boolean;
}

/**
 * Primer tope alcanzado, o `null`. Regla de ADR-038 §9: un paso que no es la redacción se rechaza si lo
 * gastado más su reserva más la reserva de la redacción superan el tope de la charla, así la persona
 * siempre puede llegar al CV con lo que confirmó. La redacción solo exige que entre su propia reserva.
 */
export function cvCoachCapReason(i: CvCoachCapInput): CvCoachCap | null {
  // `!(a < b)` y no `a >= b`: con NaN o undefined el resultado es «alcanzado»
  if (i.step === "turn" && !(i.turns < CV_COACH_MAX_TURNS)) return "turnos";
  if (i.step === "review" && !(i.reviews < CV_COACH_MAX_REVIEWS)) return "diagnosticos";
  if (!(i.flowCostUsd >= 0)) return "charla";
  const writeReserve = i.step === "write" || i.written ? 0 : CV_COACH_RESERVE_USD.write;
  const needed = i.flowCostUsd + CV_COACH_RESERVE_USD[i.step] + writeReserve;
  if (!(needed <= CV_COACH_MAX_FLOW_COST_USD)) return "charla";
  return null;
}

export interface CvCoachCapNotice {
  message: string;
  links: { label: string; href: string }[];
}

const CAP_MESSAGES: Record<CvCoachCap, string> = {
  turnos:
    "Llegamos al máximo de preguntas de esta charla. Armemos tu CV con lo que ya confirmaste.",
  diagnosticos:
    "No pudimos revisar tu CV esta vez. Podés armarlo igual con lo que confirmaste o completarlo desde las pantallas.",
  charla:
    "Esta charla llegó al tope de uso. Armemos tu CV con lo que ya confirmaste; lo demás lo podés completar desde las pantallas.",
};

const CAP_LINKS = [
  { label: "Armar mi CV", href: "/cv/coach/listo" },
  { label: "Historial", href: "/settings/historial" },
  { label: "Tu CV", href: "/cv" },
];

/** Mensaje fijo con los links: nunca depende del modelo. Siempre ofrece ir al cierre. */
export function cvCoachCapNotice(cap: CvCoachCap): CvCoachCapNotice {
  return { message: CAP_MESSAGES[cap], links: CAP_LINKS.map((l) => ({ ...l })) };
}
