/**
 * Vigencia del acceso pago de la beta (C3-1). Puro: recibe lo que está guardado en el perfil y la hora
 * actual, devuelve en qué estado está la persona y hasta cuándo llega. Sin I/O ni lectura del reloj.
 *
 * Qué rige lo decide `effectivePlan` (plans.ts); acá se suma lo que la pantalla necesita para explicarlo:
 * la fecha, los días que faltan, el aviso de los últimos días y la marca de beca. Vencer nunca borra
 * nada: solo cambia el plan que rige (a «gratis», con sus topes). Los datos de la persona siguen.
 */
import { effectivePlan, isPlanKey, planDef, type PlanKey } from "./plans";

const DAY_MS = 86_400_000;

/** Cuántos días antes de vencer la app avisa. */
export const EXPIRY_WARNING_DAYS = 3;

/**
 * Apertura de la beta cerrada: jueves 26/11/2026, 00:00 de Argentina (UTC−3, sin horario de verano).
 * Un plan que se activa antes de esta fecha cuenta sus días desde acá, para que ni el pago ni la beca
 * se gasten antes de que la beta abra.
 */
export const BETA_OPENS_AT = new Date("2026-11-26T03:00:00Z");

/** Cómo llegó el acceso: la persona pagó, o Mauro le dio la beca (primer mes gratis). */
export const PLAN_SOURCES = ["pago", "beca"] as const;
export type PlanSource = (typeof PLAN_SOURCES)[number];

export function isPlanSource(v: unknown): v is PlanSource {
  return typeof v === "string" && (PLAN_SOURCES as readonly string[]).includes(v);
}

export type AccessStatus =
  /** No tiene plan pago (o el valor guardado no se reconoce). */
  | "gratis"
  /** Plan pago vigente con más de `EXPIRY_WARNING_DAYS` días por delante. */
  | "activo"
  /** Plan pago vigente que vence en `EXPIRY_WARNING_DAYS` días o menos. */
  | "por_vencer"
  /** Tenía un plan pago y su fecha ya pasó: rige el gratis. */
  | "vencido"
  /** Plan pago sin fecha de fin (lo asignó Mauro a mano y a propósito). */
  | "sin_vencimiento";

export type PlanAccess = {
  status: AccessStatus;
  /** El plan que rige hoy. */
  plan: PlanKey;
  /**
   * Hasta cuándo llega el plan pago. Si está vencido, es la fecha en la que venció; en el gratis y
   * sin fecha, null.
   */
  until: Date | null;
  /** Días que faltan, redondeados hacia arriba (2 horas de margen = «1 día»); null si no hay fecha vigente. */
  daysLeft: number | null;
  /** El acceso viene de la beca (primer mes gratis). */
  becado: boolean;
};

export function planAccess(input: {
  plan: unknown;
  planUntil: Date | null;
  planSource: unknown;
  now: Date;
}): PlanAccess {
  const becado = isPlanSource(input.planSource) && input.planSource === "beca";
  if (!isPlanKey(input.plan) || input.plan === "gratis") {
    return { status: "gratis", plan: "gratis", until: null, daysLeft: null, becado: false };
  }
  const effective = effectivePlan(input.plan, input.planUntil, input.now);
  if (effective === "gratis") {
    return { status: "vencido", plan: "gratis", until: input.planUntil, daysLeft: null, becado };
  }
  if (!input.planUntil) {
    return { status: "sin_vencimiento", plan: effective, until: null, daysLeft: null, becado };
  }
  const daysLeft = Math.ceil((input.planUntil.getTime() - input.now.getTime()) / DAY_MS);
  return {
    status: daysLeft <= EXPIRY_WARNING_DAYS ? "por_vencer" : "activo",
    plan: effective,
    until: input.planUntil,
    daysLeft,
    becado,
  };
}

/**
 * Fecha de fin al activar o renovar un plan de `days` días:
 * - empieza en el último de estos tres momentos: ahora, la apertura de la beta, o la fecha en la que
 *   vence lo que la persona ya tenía (así renovar antes de tiempo no le hace perder días);
 * - si el plan ya venció, cuenta desde ahora, no desde la fecha vieja.
 */
export function grantPeriod(input: {
  now: Date;
  currentUntil: Date | null;
  days: number;
  opensAt?: Date;
}): Date {
  if (!Number.isInteger(input.days) || input.days < 1 || input.days > 366) {
    throw new Error("grantPeriod: los días tienen que ser un entero entre 1 y 366");
  }
  const start = Math.max(
    input.now.getTime(),
    (input.opensAt ?? BETA_OPENS_AT).getTime(),
    input.currentUntil?.getTime() ?? 0,
  );
  return new Date(start + input.days * DAY_MS);
}

/** Días que dura un mes de la beta: salen del plan, no de un número suelto. */
export function betaPeriodDays(plan: PlanKey): number {
  return planDef(plan).durationDays ?? 30;
}
