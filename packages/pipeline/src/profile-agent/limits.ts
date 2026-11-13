/**
 * Topes del agente de perfil (ADR-034). Puro: el llamador mide (llm_calls, filas marcador) y pasa los
 * números; acá solo se decide. Todo falla cerrado: un número ausente, negativo o no finito cuenta como tope
 * alcanzado. Los mensajes son fijos, con links a las pantallas manuales: nunca texto del modelo.
 */

/** Cupo de lecturas de CV por persona y por mes (decisión 5 de Mauro, 13/11): 3 gratis, 10 pago. */
export const PROFILE_AGENT_READS_PER_MONTH = { free: 3, paid: 10 } as const;
/** Ventana móvil: los mismos 30 días que el resto de los topes por `llm_calls`. */
export const PROFILE_AGENT_WINDOW_DAYS = 30;
/** Lecturas por persona y día (frena el reintento en bucle; los USD ya lo acotan, esto lo hace visible). */
export const PROFILE_AGENT_MAX_READS_PER_DAY = 3;

/**
 * Reserva de la lectura antes de llamar al modelo (máximo del paso, no el promedio): el texto más largo
 * que acepta la ruta (`CV_MAX_TEXT_CHARS`), el primario agotando `max_tokens` y el respaldo agotando el
 * suyo. R10-1 la recalcula con la fila real de `model_routing` en un test de adapters y la sube si queda corta.
 */
export const PROFILE_AGENT_READ_RESERVE_USD = 0.08;

/** Etapa de huecos: llamadas al modelo (`cv_interview`) por charla, repreguntas incluidas. */
export const PROFILE_AGENT_MAX_GAP_TURNS = 20;
/** Repreguntas por tema (decisión de R10-3). El tema que sigue flojo se saltea. */
export const PROFILE_AGENT_MAX_FOLLOW_UPS = 2;
/** Gasto real de una charla completa (lectura, huecos y redacción). */
export const PROFILE_AGENT_MAX_FLOW_COST_USD = 0.3;
/** Gasto real por persona y día, de todas sus charlas. */
export const PROFILE_AGENT_USER_DAILY_CAP_USD = 0.5;
export const PROFILE_AGENT_DEFAULT_DAILY_CAP_USD = 1;

/**
 * Gasto de una fila de `llm_calls` para los topes de USD (por charla, por persona, por día y global).
 * Las llamadas fallidas llegan con `cost_usd` null (en la R9 ningún tope las veía): se cuentan con
 * `COALESCE(cost_usd, <reserva o estimado del paso>)`. Esta función es el espejo en código de ese
 * COALESCE y lo que R10-1 usa en su test; la consulta SQL debe hacer lo mismo. Un costo inválido
 * (negativo, NaN) también cae al estimado: nunca resta del tope.
 */
export function profileAgentRowCostUsd(
  costUsd: number | null | undefined,
  stepEstimateUsd: number,
): number {
  return typeof costUsd === "number" && Number.isFinite(costUsd) && costUsd >= 0
    ? costUsd
    : stepEstimateUsd;
}

export type ProfileAgentPlan = "free" | "paid";

export function profileAgentReadsPerMonth(plan: ProfileAgentPlan): number {
  return plan === "paid" ? PROFILE_AGENT_READS_PER_MONTH.paid : PROFILE_AGENT_READS_PER_MONTH.free;
}

/** Tope global por día desde `CV_PROFILE_AGENT_DAILY_CAP_USD`. Ausente = 1,00; mal escrito o negativo = 0 (cerrado). */
export function profileAgentDailyCapUsd(env: Record<string, string | undefined>): number {
  const raw = env.CV_PROFILE_AGENT_DAILY_CAP_USD?.trim();
  if (raw === undefined || raw === "") return PROFILE_AGENT_DEFAULT_DAILY_CAP_USD;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export type ProfileAgentCap =
  "lecturas_mes" | "lecturas_dia" | "turnos" | "charla" | "usuario" | "global";

export type ProfileAgentStage = "read" | "gaps" | "write";

export interface ProfileAgentCapInput {
  /** Paso que se quiere hacer. La guía no llama al modelo y no pasa por acá. */
  stage: ProfileAgentStage;
  /** `profileAgentQuotaExempt`: sin tope de lecturas; los de USD rigen igual. */
  exempt: boolean;
  /** Lecturas COMPLETAS (fila marcador `profile_read`) en la ventana mensual. Las que fallan o se cortan no cuentan. */
  readsThisMonth: number;
  readsPerMonth: number;
  /** Intentos de lectura de hoy (los que fallaron también: son los que pueden costar). */
  readsToday: number;
  /** Llamadas `cv_interview` de esta charla (por `label`, no por lo que diga el navegador). */
  gapTurns: number;
  /** Gasto de esta charla (suma de `cost_usd` con su `label`). */
  flowCostUsd: number;
  /** Gasto de esta persona en las últimas 24 h, de todas sus charlas. */
  userSpendTodayUsd: number;
  /** Gasto global del agente en las últimas 24 h. */
  dailySpendUsd: number;
  dailyCapUsd: number;
}

/** Primer tope alcanzado, o `null`. Orden: lecturas, turnos, charla, persona-día, global. */
export function profileAgentCapReason(i: ProfileAgentCapInput): ProfileAgentCap | null {
  // `!(a < b)` y no `a >= b`: con NaN o undefined el resultado es «alcanzado»
  if (i.stage === "read" && !i.exempt) {
    if (!(i.readsThisMonth < i.readsPerMonth)) return "lecturas_mes";
    if (!(i.readsToday < PROFILE_AGENT_MAX_READS_PER_DAY)) return "lecturas_dia";
  }
  if (i.stage === "gaps" && !(i.gapTurns < PROFILE_AGENT_MAX_GAP_TURNS)) return "turnos";
  if (i.stage !== "read" && !(i.flowCostUsd < PROFILE_AGENT_MAX_FLOW_COST_USD)) return "charla";
  if (!(i.userSpendTodayUsd < PROFILE_AGENT_USER_DAILY_CAP_USD)) return "usuario";
  if (!(i.dailySpendUsd < i.dailyCapUsd) || !(i.dailyCapUsd > 0)) return "global";
  return null;
}

export interface ProfileAgentCapNotice {
  message: string;
  links: { label: string; href: string }[];
}

const CAP_LINKS = [
  { label: "Tu perfil", href: "/settings/perfil" },
  { label: "Historial", href: "/settings/historial" },
  { label: "Mis skills", href: "/settings/skills" },
  { label: "Tu CV", href: "/cv" },
];

const CAP_MESSAGES: Record<ProfileAgentCap, string> = {
  lecturas_mes:
    "Llegaste al tope de lecturas de CV de este mes. Podés completar tu perfil a mano desde las pantallas y volver el mes que viene.",
  lecturas_dia:
    "Hoy ya leíste tu CV varias veces. Podés completar tu perfil a mano desde las pantallas y volver mañana.",
  turnos:
    "Esta charla llegó al máximo de preguntas. Lo que confirmaste ya está en tu perfil y lo podés completar desde las pantallas.",
  charla:
    "Esta charla llegó al tope de uso. Lo que confirmaste ya está en tu perfil y lo podés completar desde las pantallas.",
  usuario:
    "Hoy llegaste al tope de uso de la guía con IA. Podés completar tu perfil a mano desde las pantallas y volver mañana.",
  global:
    "Hoy la guía con IA no está disponible. Podés completar tu perfil a mano desde las pantallas y volver mañana.",
};

/** Mensaje fijo con los links a las pantallas manuales: nunca depende del modelo. */
export function profileAgentCapNotice(cap: ProfileAgentCap): ProfileAgentCapNotice {
  return { message: CAP_MESSAGES[cap], links: CAP_LINKS.map((l) => ({ ...l })) };
}

/** Desde cuándo se cuenta cada ventana, con `now` inyectado. */
export function profileAgentWindows(now: Date): { monthSince: Date; daySince: Date } {
  const t = now.getTime();
  return {
    monthSince: new Date(t - PROFILE_AGENT_WINDOW_DAYS * 24 * 3600 * 1000),
    daySince: new Date(t - 24 * 3600 * 1000),
  };
}
