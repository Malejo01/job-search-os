/**
 * Aviso por email antes de que venza el plan pago (C4-1). Puro: decide a quién avisar y arma el texto;
 * no manda nada, no lee el reloj ni toca la base (eso lo hace `adapters/billing/plan-expiry-notices.ts`).
 *
 * Un solo aviso por vencimiento. `profiles.plan_notified_at` guarda cuándo se avisó; ese aviso vale solo
 * para el vencimiento en curso: al renovar, `plan_until` se corre y el siguiente aviso vuelve a
 * corresponder. Vencer nunca borra nada (C3-1): el texto lo dice, y es lo que muestra Ajustes.
 */
import { EXPIRY_WARNING_DAYS, planAccess } from "./plan-access";
import { PRODUCT_NAME } from "./product";

const DAY_MS = 86_400_000;
/** Argentina no tiene horario de verano: siempre UTC−3. */
const AR_OFFSET_MS = 3 * 3_600_000;

export type PlanNoticeCandidate = {
  userId: string;
  plan: unknown;
  planUntil: Date | null;
  planSource: unknown;
  /** Cuándo se mandó el último aviso (null = nunca). */
  planNotifiedAt: Date | null;
};

/**
 * ¿Corresponde avisarle ahora? Sí si tiene un plan pago vigente que vence en `EXPIRY_WARNING_DAYS` días
 * o menos y todavía no se le avisó de este vencimiento. Un aviso es de este vencimiento si se mandó desde
 * que se abrió la ventana (`plan_until` menos 3 días); uno anterior es de un vencimiento viejo.
 */
export function isPlanNoticeDue(c: PlanNoticeCandidate, now: Date): boolean {
  const access = planAccess({
    plan: c.plan,
    planUntil: c.planUntil,
    planSource: c.planSource,
    now,
  });
  if (access.status !== "por_vencer" || !c.planUntil) return false;
  if (!c.planNotifiedAt) return true;
  const windowStart = c.planUntil.getTime() - EXPIRY_WARNING_DAYS * DAY_MS;
  return c.planNotifiedAt.getTime() < windowStart;
}

/**
 * A quiénes avisar en esta corrida: las que corresponden, las que vencen antes primero, una vez por
 * persona y hasta `limit`. Con un tope que no es un entero positivo no elige a nadie.
 */
export function selectPlanNotices<T extends PlanNoticeCandidate>(
  candidates: readonly T[],
  opts: { now: Date; limit: number },
): T[] {
  if (!Number.isInteger(opts.limit) || opts.limit <= 0) return [];
  const due = candidates
    .filter((c) => isPlanNoticeDue(c, opts.now))
    .sort(
      (a, b) =>
        (a.planUntil?.getTime() ?? 0) - (b.planUntil?.getTime() ?? 0) ||
        (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0),
    );
  const seen = new Set<string>();
  const out: T[] = [];
  for (const c of due) {
    if (seen.has(c.userId)) continue;
    seen.add(c.userId);
    out.push(c);
    if (out.length >= opts.limit) break;
  }
  return out;
}

/** Emails de avisos por día si no se configura otro tope. */
export const PLAN_NOTICE_DAILY_CAP_DEFAULT = 30;
/** Máximo posible: Resend gratis permite 100 por día y los reseteos y los avisos de feedback comparten ese cupo. */
export const PLAN_NOTICE_DAILY_CAP_MAX = 80;

/** Tope diario de avisos desde la variable `PLAN_NOTICE_DAILY_CAP`; un valor inválido cae al default. */
export function planNoticeDailyCap(raw: string | undefined): number {
  const text = raw?.trim();
  if (!text || !/^\d+$/.test(text)) return PLAN_NOTICE_DAILY_CAP_DEFAULT;
  return Math.min(Number(text), PLAN_NOTICE_DAILY_CAP_MAX);
}

const MONTHS = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
] as const;

/** «26 de noviembre» según la hora de Argentina (sin depender de ICU ni de la zona del servidor). */
export function formatNoticeDate(date: Date): string {
  const ar = new Date(date.getTime() - AR_OFFSET_MS);
  return `${ar.getUTCDate()} de ${MONTHS[ar.getUTCMonth()]}`;
}

export type PlanNoticeEmailInput = {
  displayName: string;
  until: Date;
  /** Link de pago ya validado (`paymentLink`); null si no hay. */
  paymentUrl: string | null;
  /** Link a «Tu plan» en Ajustes. */
  settingsUrl: string;
  /** Email de contacto ya validado; null si no hay. */
  contactEmail: string | null;
  /** El acceso viene de la beca (primer mes gratis). */
  becado: boolean;
};

function firstName(displayName: string): string {
  const name = displayName.trim().split(/\s+/)[0] ?? "";
  return name.slice(0, 40);
}

/**
 * Texto simple del aviso, en español rioplatense. Dice hasta cuándo llega el acceso, cómo renovar y
 * qué pasa si no se renueva (pasa al plan gratis y no se pierde nada). No promete garantía ni
 * reintegros: la activación es manual y el aviso lo dice.
 */
export function buildPlanNoticeEmail(input: PlanNoticeEmailInput): {
  subject: string;
  text: string;
} {
  const date = formatNoticeDate(input.until);
  const name = firstName(input.displayName);
  const what = input.becado ? "Tu mes de beca" : "Tu acceso a la Beta";
  const subject = input.becado
    ? `Tu mes de beca en ${PRODUCT_NAME} vence el ${date}`
    : `Tu acceso a la Beta de ${PRODUCT_NAME} vence el ${date}`;

  const lines: string[] = [];
  lines.push(name ? `Hola ${name}:` : "Hola,");
  lines.push("");
  lines.push(`${what} de ${PRODUCT_NAME} vence el ${date}.`);
  lines.push("");
  if (input.paymentUrl) {
    lines.push("Si querés seguir con el plan completo, pagá el mes con Mercado Pago:");
    lines.push(input.paymentUrl);
    lines.push(
      "Cuando se acredite el pago lo activamos a mano y se suman 30 días a lo que te queda.",
    );
    if (input.contactEmail) {
      lines.push(
        `También podés pagar por transferencia: escribinos a ${input.contactEmail} y te pasamos los datos.`,
      );
    }
  } else if (input.contactEmail) {
    lines.push(
      `Si querés seguir con el plan completo, escribinos a ${input.contactEmail} y te contamos cómo renovarlo.`,
    );
  } else {
    lines.push("Si querés seguir con el plan completo, mirá cómo renovarlo en Ajustes.");
  }
  lines.push("");
  lines.push(
    "Si no lo renovás, tu cuenta pasa al plan gratis. No perdés nada: tu perfil, tus ofertas y tus postulaciones siguen guardados; solo cambian los topes de uso.",
  );
  lines.push("");
  lines.push(`Tu plan, en cualquier momento: ${input.settingsUrl}`);
  lines.push("");
  lines.push("Este aviso te llega una sola vez por vencimiento.");
  lines.push(PRODUCT_NAME);
  return { subject, text: lines.join("\n") };
}
