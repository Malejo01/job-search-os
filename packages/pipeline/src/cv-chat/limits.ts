/**
 * Topes y gate del chat de CV (C-25). Puro: el llamador mide (llm_calls, conteo por plan) y pasa los números;
 * acá solo se decide. Todo falla cerrado: un número ausente, negativo o no finito cuenta como tope alcanzado.
 */
import { CV_CHAT_MAX_TURNS } from "./state";

export const CV_CHAT_MAX_COST_USD = 0.15;
export const CV_CHAT_DEFAULT_DAILY_CAP_USD = 1;
/** Ventana del tope mensual: mismos 30 días móviles que el resto de los topes por `llm_calls`. */
export const CV_CHAT_MONTH_DAYS = 30;

/** Por persona y día: gasto de entrevistas (sin `write`, que ya cuenta en el cupo mensual) y charlas nuevas. */
export const CV_CHAT_USER_DAILY_CAP_USD = 0.3;
export const CV_CHAT_MAX_STARTS_PER_DAY = 5;
/**
 * Máximo que se reserva antes de llamar al modelo (la reserva se borra al terminar el paso). Es el tope del
 * paso, no el promedio: el prompt más largo que acepta la ruta, el primario agotando `max_tokens` y, si
 * falla, el respaldo agotando el suyo (Haiku con su presupuesto de thinking). Con las filas de
 * `model_routing` de hoy da USD 0,0241 por turno y 0,0693 por redacción; un test de adapters
 * (`estimate.test.ts`) recalcula ese máximo con el seed y falla si estas constantes quedan cortas.
 */
export const CV_CHAT_TURN_RESERVE_USD = 0.025;
export const CV_CHAT_WRITE_RESERVE_USD = 0.07;

export type CvChatCap = "mes" | "turnos" | "conversacion" | "usuario" | "inicios" | "global";

export interface CvChatCapInput {
  /** Mensajes de la persona ya procesados en esta conversación. */
  turns: number;
  /** Gasto de esta conversación (suma de `cost_usd` con su `label`). */
  conversationCostUsd: number;
  /** CV armados por esta persona en la ventana mensual (`cvChatWindows`). */
  cvThisMonth: number;
  /** Tope por mes del plan que rige hoy (gratis 1, pago 5), leído de `plans.ts` por el llamador. */
  cvPerMonth: number;
  /** Gasto de entrevistas (`cv_interview`) de esta persona en las últimas 24 h, de todas sus charlas. */
  userInterviewSpendUsd: number;
  /** Gasto global de la tarea en las últimas 24 h. */
  dailySpendUsd: number;
  dailyCapUsd: number;
}

/** Primer tope alcanzado, o `null`. Orden: mes, turnos, conversación, persona-día, global. */
export function cvChatCapReason(i: CvChatCapInput): CvChatCap | null {
  // `!(a < b)` y no `a >= b`: con NaN o undefined el resultado es «alcanzado»
  if (!(i.cvThisMonth < i.cvPerMonth)) return "mes";
  if (!(i.turns < CV_CHAT_MAX_TURNS)) return "turnos";
  if (!(i.conversationCostUsd < CV_CHAT_MAX_COST_USD)) return "conversacion";
  if (!(i.userInterviewSpendUsd < CV_CHAT_USER_DAILY_CAP_USD)) return "usuario";
  if (!(i.dailySpendUsd < i.dailyCapUsd) || !(i.dailyCapUsd > 0)) return "global";
  return null;
}

/** Charlas nuevas por persona y día (no hay llamada al modelo que las cuente: se registra una fila `cv_start`). */
export function cvChatStartCapReason(startsToday: number): "inicios" | null {
  return startsToday < CV_CHAT_MAX_STARTS_PER_DAY ? null : "inicios";
}

export interface CvChatCapNotice {
  message: string;
  links: { label: string; href: string }[];
}

const CAP_LINKS = [
  { label: "Tu perfil", href: "/settings/perfil" },
  { label: "Historial", href: "/settings/historial" },
  { label: "Mis skills", href: "/settings/skills" },
  { label: "Tu CV", href: "/cv" },
];

const CAP_MESSAGES: Record<CvChatCap, string> = {
  mes: "Llegaste al tope de CV armados con IA de este mes. Todo lo podés cargar a mano desde las pantallas.",
  turnos:
    "Esta charla llegó al máximo de mensajes. Lo que armaste se puede revisar y completar desde las pantallas.",
  conversacion:
    "Esta charla llegó al tope de uso. Lo que armaste se puede revisar y completar desde las pantallas.",
  usuario:
    "Hoy llegaste al tope de uso del armado de CV con IA. Todo lo podés cargar a mano desde las pantallas y volver mañana.",
  inicios:
    "Hoy ya empezaste varias charlas para armar tu CV. Todo lo podés cargar a mano desde las pantallas y volver mañana.",
  global:
    "Hoy el armado de CV con IA no está disponible. Todo lo podés cargar a mano desde las pantallas y volver mañana.",
};

/** Mensaje fijo (100 §2.4) con los links a las pantallas: nunca depende del modelo. */
export function cvChatCapNotice(cap: CvChatCap): CvChatCapNotice {
  return { message: CAP_MESSAGES[cap], links: CAP_LINKS.map((l) => ({ ...l })) };
}

/** Tope diario global desde `CV_CHAT_DAILY_CAP_USD`. Ausente = 1,00; mal escrito o negativo = 0 (cerrado). */
export function cvChatDailyCapUsd(env: Record<string, string | undefined>): number {
  const raw = env.CV_CHAT_DAILY_CAP_USD?.trim();
  if (raw === undefined || raw === "") return CV_CHAT_DEFAULT_DAILY_CAP_USD;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** `CV_CHAT_ENABLED`: `all` abre a todos, `admin` solo al admin, cualquier otro valor lo apaga. */
export function cvChatEnabled(env: Record<string, string | undefined>, isAdmin: boolean): boolean {
  const v = env.CV_CHAT_ENABLED?.trim().toLowerCase();
  if (v === "all") return true;
  if (v === "admin") return isAdmin;
  return false;
}

/** Desde cuándo se cuenta cada ventana, con `now` inyectado. */
export function cvChatWindows(now: Date): { monthSince: Date; daySince: Date } {
  const t = now.getTime();
  return {
    monthSince: new Date(t - CV_CHAT_MONTH_DAYS * 24 * 3600 * 1000),
    daySince: new Date(t - 24 * 3600 * 1000),
  };
}
