import { z } from "zod";
import { err, ok, type Result } from "../result";
import { planDef, resolvePlanLimit } from "../plans";

/**
 * Topes del asistente (Fase 7, etapa 3). Puro: el llamador trae lo gastado y las tarifas de
 * `model_routing`; acá solo se decide. Todos fallan cerrado: si falta un dato para controlar el
 * gasto (una tarifa, el costo de una llamada), el asistente se corta en vez de seguir a ciegas.
 */
export const AGENT_LIMITS = {
  maxTurnsPerConversation: 20,
  maxStepsPerTurn: 6,
  maxOutputTokensPerStep: 600,
  maxInputTokensPerCall: 12_000,
  maxUsdPerConversation: 0.5,
  maxUserMessageChars: 2_000,
} as const;

/** Los dos topes que se pueden cambiar sin deploy (variables de entorno, leídas en el borde). */
export type ConversationLimits = { maxTurnsPerConversation: number; maxUsdPerConversation: number };

export const DEFAULT_CONVERSATION_LIMITS: ConversationLimits = {
  maxTurnsPerConversation: AGENT_LIMITS.maxTurnsPerConversation,
  maxUsdPerConversation: AGENT_LIMITS.maxUsdPerConversation,
};

/** Techos de lo configurable: un valor mal puesto (por ejemplo 500) no deja el tope sin efecto. */
export const MAX_CONFIGURABLE_TURNS = 50;
export const MAX_CONFIGURABLE_USD = 5;

const turnsOverride = z
  .string()
  .regex(/^\d{1,3}$/)
  .transform(Number)
  .pipe(z.number().int().min(1).max(MAX_CONFIGURABLE_TURNS));
const usdOverride = z
  .string()
  .regex(/^\d{1,2}(\.\d{1,4})?$/)
  .transform(Number)
  .pipe(z.number().gt(0).max(MAX_CONFIGURABLE_USD));

/**
 * Topes de la charla a partir de lo que dicen las variables `ASSISTANT_MAX_TURNS` y
 * `ASSISTANT_MAX_USD_PER_CONVERSATION` (el borde pasa los textos crudos; acá no se lee el entorno).
 * Ausente o vacía = el default, sin ruido. Inválida = el default y se informa en `invalid` para que
 * el borde la loguee. Nunca falla: un error de configuración no debe tumbar al asistente.
 */
export function resolveConversationLimits(raw: {
  maxTurns?: string | undefined;
  maxUsd?: string | undefined;
}): { limits: ConversationLimits; invalid: ("maxTurns" | "maxUsd")[] } {
  const limits = { ...DEFAULT_CONVERSATION_LIMITS };
  const invalid: ("maxTurns" | "maxUsd")[] = [];
  const turns = raw.maxTurns?.trim() ?? "";
  if (turns !== "") {
    const p = turnsOverride.safeParse(turns);
    if (p.success) limits.maxTurnsPerConversation = p.data;
    else invalid.push("maxTurns");
  }
  const usd = raw.maxUsd?.trim() ?? "";
  if (usd !== "") {
    const p = usdOverride.safeParse(usd);
    if (p.success) limits.maxUsdPerConversation = p.data;
    else invalid.push("maxUsd");
  }
  return { limits, invalid };
}

export const AGENT_CAP_REASONS = [
  "turns",
  "steps",
  "input_tokens",
  "usd",
  "monthly_conversations",
  "message_too_long",
  "cost_unknown",
] as const;
export type AgentCapReason = (typeof AGENT_CAP_REASONS)[number];

/** Uso acumulado de una conversación. `costUsd` null = alguna llamada sin costo conocido. */
export type ConversationUsage = { turns: number; costUsd: number | null };

/** Tarifas de la fila de `model_routing` (USD por millón de tokens); null = desconocida. */
export type AgentRates = { inputUsdPerMtok: number | null; outputUsdPerMtok: number | null };

/** Estimación conservadora (un token cada 3 caracteres): mejor sobreestimar que pasarse. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3);
}

/** Número finito y no negativo. Todo lo demás (NaN, ±Infinity, negativos, null) no se usa. */
export function isNonNegFinite(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x) && x >= 0;
}

/** Contador válido: entero no negativo. */
const isCount = (x: unknown): x is number => isNonNegFinite(x) && Number.isInteger(x);

/** Suma de costos; un null o un valor inválido contagia (no se controla lo que no se conoce). */
export function addCost(a: number | null, b: number | null): number | null {
  return isNonNegFinite(a) && isNonNegFinite(b) ? a + b : null;
}

/** Costo real de un paso; null si falta (o es inválida) una tarifa o un conteo de tokens. */
export function stepCostUsd(
  rates: AgentRates,
  tokensIn: number | null,
  tokensOut: number | null,
): number | null {
  const { inputUsdPerMtok: inRate, outputUsdPerMtok: outRate } = rates;
  if (!isNonNegFinite(inRate) || !isNonNegFinite(outRate)) return null;
  if (!isNonNegFinite(tokensIn) || !isNonNegFinite(tokensOut)) return null;
  const cost = (tokensIn * inRate + tokensOut * outRate) / 1_000_000;
  return isNonNegFinite(cost) ? cost : null;
}

/** Peor caso de un paso: la entrada estimada más la salida máxima. null si falta una tarifa. */
export function maxStepCostUsd(rates: AgentRates, inputTokens: number): number | null {
  return stepCostUsd(rates, inputTokens, AGENT_LIMITS.maxOutputTokensPerStep);
}

/** En micro-dólares: 0,1 + 0,02 en coma flotante da 0,12000000000000001. */
const micro = (usd: number): number => Math.round(usd * 1e6);

/**
 * ¿Puede empezar un turno? Una conversación nueva cuenta contra el cupo mensual; después se miran
 * los turnos y lo gastado. Las comparaciones van en forma positiva («sigue solo si está por
 * debajo»), así un NaN o un dato faltante corta en vez de dejar pasar.
 *
 * CONTRATO para la ruta (AG-3): `isNewConversation`, `usage.costUsd` y `monthly.used` se calculan
 * en el servidor desde `llm_calls` (label `conv:<id>`: gasto de esa conversación y cantidad de
 * labels distintos del mes), nunca desde lo que manda el cliente. `usage.turns` sale del historial
 * del cliente: un cliente que miente ahí solo consigue más turnos dentro del mismo tope en USD.
 * Contadores inválidos cortan por su motivo («monthly_conversations», «turns»); costo inválido,
 * por «cost_unknown».
 */
export function checkTurnStart(
  usage: ConversationUsage,
  monthly: { used: number; limit: number },
  isNewConversation: boolean,
  limits: ConversationLimits = DEFAULT_CONVERSATION_LIMITS,
): Result<void, AgentCapReason> {
  if (isNewConversation && !(isCount(monthly.used) && isCount(monthly.limit))) {
    return err("monthly_conversations");
  }
  if (isNewConversation && !(monthly.used < monthly.limit)) return err("monthly_conversations");
  if (!isCount(usage.turns) || !(usage.turns < limits.maxTurnsPerConversation)) {
    return err("turns");
  }
  if (!isNonNegFinite(usage.costUsd)) return err("cost_unknown");
  if (!(micro(usage.costUsd) < micro(limits.maxUsdPerConversation))) return err("usd");
  return ok(undefined);
}

/**
 * ¿Puede correr el paso `step` (0-based) de un turno? Exige que el peor caso del paso entre en lo
 * que queda de la conversación. Un paso inválido corta por «steps»; una estimación inválida, por
 * «input_tokens»; un costo inválido, por «cost_unknown».
 */
export function checkStep(
  step: number,
  inputTokensEstimate: number,
  spentUsd: number | null,
  nextStepMaxUsd: number | null,
  limits: ConversationLimits = DEFAULT_CONVERSATION_LIMITS,
): Result<void, AgentCapReason> {
  if (!isCount(step) || !(step < AGENT_LIMITS.maxStepsPerTurn)) return err("steps");
  if (
    !isNonNegFinite(inputTokensEstimate) ||
    !(inputTokensEstimate <= AGENT_LIMITS.maxInputTokensPerCall)
  ) {
    return err("input_tokens");
  }
  if (!isNonNegFinite(spentUsd) || !isNonNegFinite(nextStepMaxUsd)) return err("cost_unknown");
  if (!(micro(spentUsd + nextStepMaxUsd) <= micro(limits.maxUsdPerConversation))) {
    return err("usd");
  }
  return ok(undefined);
}

/** Largo del mensaje de la persona: lo que pasa del tope no se manda. */
export function checkUserMessage(text: string): Result<void, AgentCapReason> {
  return text.length > AGENT_LIMITS.maxUserMessageChars ? err("message_too_long") : ok(undefined);
}

const MAX_MONTHLY_OVERRIDE = 1000;

/**
 * Charlas por mes: `ASSISTANT_MONTHLY_CONVERSATIONS` (entero 1..1000, para que el admin pruebe)
 * pisa todo; si no, el del plan con `PRICING_ENABLED` y, apagado, el del plan gratis.
 */
export function monthlyConversationLimit(
  env: Record<string, string | undefined>,
  input: { plan: unknown; planUntil: Date | null; now: Date },
): number {
  const raw = env.ASSISTANT_MONTHLY_CONVERSATIONS?.trim() ?? "";
  if (/^\d{1,4}$/.test(raw)) {
    const n = Number(raw);
    if (n >= 1 && n <= MAX_MONTHLY_OVERRIDE) return n;
  }
  return resolvePlanLimit(env, "conversationsPerMonth", {
    override: null,
    plan: input.plan,
    planUntil: input.planUntil,
    now: input.now,
    fallback: planDef("gratis").limits.conversationsPerMonth,
  });
}

export type AgentLink = { href: string; label: string };

/** Pantallas donde la persona puede hacer a mano lo que el asistente no pudo. */
export const AGENT_SCREEN_LINKS: readonly AgentLink[] = [
  { href: "/settings/perfil", label: "Tu perfil" },
  { href: "/settings/skills", label: "Tus skills" },
  { href: "/settings/criteria", label: "Criterios" },
  { href: "/settings#puesto", label: "Tus puestos" },
];

const CAP_TEXT: Record<AgentCapReason, string> = {
  turns:
    "Llegaste al tope de mensajes de esta charla. Podés empezar una nueva o hacer los cambios directamente en estas pantallas:",
  steps:
    "Esta respuesta necesitaba más pasos de los permitidos y se cortó. Probá con una pregunta más concreta o hacé el cambio en estas pantallas:",
  input_tokens:
    "La charla quedó demasiado larga para seguir. Empezá una nueva o hacé el cambio en estas pantallas:",
  usd: "Llegaste al tope de uso de esta charla. Empezá una nueva o hacé el cambio en estas pantallas:",
  monthly_conversations:
    "Este mes ya usaste todas las charlas con el asistente de tu plan. Mientras tanto, podés hacer los cambios en estas pantallas:",
  message_too_long:
    "Ese mensaje es muy largo para el asistente. Escribilo más corto o hacé el cambio en estas pantallas:",
  cost_unknown:
    "El asistente no está disponible ahora. Podés hacer los cambios directamente en estas pantallas:",
};

/** Desde cuántos mensajes restantes se le avisa a la persona. */
export const REMAINING_WARN_AT = 2;

/** Mensajes que le quedan a la charla, dados los que la persona ya envió (incluido el último). */
export function remainingMessages(
  userMessagesSent: number,
  maxTurns: number = AGENT_LIMITS.maxTurnsPerConversation,
): number {
  if (!isCount(userMessagesSent)) return 0;
  return Math.max(0, maxTurns - userMessagesSent);
}

/** «Te quedan N mensajes…» solo cuando quedan entre 1 y `REMAINING_WARN_AT`; si no, null. */
export function remainingMessagesNotice(
  userMessagesSent: number,
  maxTurns: number = AGENT_LIMITS.maxTurnsPerConversation,
): string | null {
  const left = remainingMessages(userMessagesSent, maxTurns);
  if (left < 1 || left > REMAINING_WARN_AT) return null;
  return left === 1
    ? "Te queda 1 mensaje en esta charla"
    : `Te quedan ${left} mensajes en esta charla`;
}

/** Topes que cierran la charla (seguir escribiendo no sirve); los otros se resuelven con otro mensaje. */
export function isFinalCap(reason: AgentCapReason): boolean {
  return reason !== "message_too_long" && reason !== "steps";
}

/** Mensaje fijo al llegar a un tope: siempre el mismo texto y los mismos links, sin el modelo. */
export function capMessage(reason: AgentCapReason): { text: string; links: AgentLink[] } {
  return { text: CAP_TEXT[reason] ?? CAP_TEXT.cost_unknown, links: [...AGENT_SCREEN_LINKS] };
}
