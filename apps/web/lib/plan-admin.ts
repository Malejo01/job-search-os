import {
  BETA_PLAN,
  betaPeriodDays,
  grantPeriod,
  isPlanActivation,
  isPlanOverride,
  isPlanSource,
  type PlanOverride,
  type PlanSource,
} from "@job-search-os/pipeline";
import { sql } from "drizzle-orm";
import { withUser } from "./db";
import { canCreateInvitations, NotInvitationAdminError } from "./invitations";
import { isValidEmail, normalizeEmail } from "./invitations-core";

/**
 * Planes de la beta desde el panel de admin (C3-1), solo servidor. La app no puede cambiar `profiles.plan`
 * (trigger de rls/0010): todo pasa por admin_plan_* (packages/db/rls/0015_admin_planes.sql). Dos barreras,
 * como en la lista de espera: cada función verifica ADMIN_EMAILS y la base exige además `app_admins`.
 * Las fechas las calcula el pipeline (`grantPeriod`); la base solo las acota. El email de la persona no va
 * a los logs ni a la URL.
 */

export class PlanAdminNotEnabledInDbError extends Error {
  constructor() {
    super("la cuenta es admin en la app pero no está habilitada en la base (app_admins)");
    this.name = "PlanAdminNotEnabledInDbError";
  }
}

async function guarded<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    for (let e: unknown = error; e && typeof e === "object"; e = (e as { cause?: unknown }).cause) {
      const message = (e as { message?: unknown }).message;
      if (
        typeof message === "string" &&
        (message.includes("admin_plan: no autorizado") ||
          message.includes("admin_plan_override: no autorizado") ||
          message.includes("admin_payment_notice: no autorizado") ||
          message.includes("admin_plan_events: no autorizado"))
      ) {
        throw new PlanAdminNotEnabledInDbError();
      }
    }
    throw error;
  }
}

async function assertAdmin(userId: string): Promise<void> {
  if (!(await canCreateInvitations(userId))) throw new NotInvitationAdminError();
}

type PlanRowRaw = {
  plan: string;
  plan_source: string | null;
  plan_until: Date | string | null;
};

export type AdminPlanRow = {
  email: string;
  plan: string;
  planSource: PlanSource | null;
  planUntil: Date | null;
};

function toDate(v: Date | string | null): Date | null {
  return v ? new Date(v) : null;
}

/** Personas con (o que tuvieron) un plan pago, las que vencen antes primero. Tope de 200 (lo impone la base). */
export async function listPlans(userId: string): Promise<AdminPlanRow[]> {
  await assertAdmin(userId);
  const rows = (await guarded(() =>
    withUser(userId, (tx) => tx.execute(sql`select * from public.admin_plan_list(200)`)),
  )) as unknown as (PlanRowRaw & { email: string })[];
  return rows.map((r) => ({
    email: r.email,
    plan: r.plan,
    planSource: isPlanSource(r.plan_source) ? r.plan_source : null,
    planUntil: toDate(r.plan_until),
  }));
}

export type GrantResult =
  | {
      ok: true;
      source: PlanSource;
      until: Date;
      /** El plan no estaba vigente (C8-7): es una activación, no una renovación. */
      activated: boolean;
      /** Email normalizado de la persona, para la bienvenida. Nunca va a los logs ni a la URL. */
      email: string;
    }
  | { ok: false; reason: "email_invalido" | "no_existe" | "plan_viejo" };

/**
 * Activa o renueva el plan de la beta: 30 días (los del plan) desde el último de ahora, la apertura de la
 * beta o la fecha en la que ya vencía. Un becado marcado como «beca» tiene su primer mes gratis; cuando
 * paga, se lo activa de nuevo como «pago» y los días se suman. No toca a quien tiene un plan viejo
 * (fundador, pase de 3 meses): esos se cambian a mano y acá se avisa.
 */
export async function grantBetaPlan(
  userId: string,
  input: { email: string; source: PlanSource },
  now: Date = new Date(),
): Promise<GrantResult> {
  await assertAdmin(userId);
  const email = normalizeEmail(input.email);
  if (!isValidEmail(email)) return { ok: false, reason: "email_invalido" };
  const [current] = (await guarded(() =>
    withUser(userId, (tx) => tx.execute(sql`select * from public.admin_plan_get(${email})`)),
  )) as unknown as PlanRowRaw[];
  if (!current) return { ok: false, reason: "no_existe" };
  if (current.plan !== "gratis" && current.plan !== BETA_PLAN) {
    return { ok: false, reason: "plan_viejo" };
  }
  const until = grantPeriod({
    now,
    currentUntil: current.plan === BETA_PLAN ? toDate(current.plan_until) : null,
    days: betaPeriodDays(BETA_PLAN),
  });
  const [saved] = (await guarded(() =>
    withUser(userId, (tx) =>
      tx.execute(
        sql`select * from public.admin_plan_set(${email}, ${BETA_PLAN}, ${input.source}, ${until.toISOString()}::timestamptz)`,
      ),
    ),
  )) as unknown as PlanRowRaw[];
  if (!saved) return { ok: false, reason: "no_existe" };
  const activated = isPlanActivation(
    { plan: current.plan, planUntil: toDate(current.plan_until) },
    now,
  );
  return {
    ok: true,
    source: input.source,
    until: toDate(saved.plan_until) ?? until,
    activated,
    email,
  };
}

export type AdminOverrideRow = { email: string; override: PlanOverride; createdAt: Date };

/** Personas con precio especial (ADR-040), las más nuevas primero. Tope de 200 (lo impone la base). */
export async function listPlanOverrides(userId: string): Promise<AdminOverrideRow[]> {
  await assertAdmin(userId);
  const rows = (await guarded(() =>
    withUser(userId, (tx) => tx.execute(sql`select * from public.admin_plan_override_list(200)`)),
  )) as unknown as { email: string; override: string; created_at: Date | string }[];
  return rows.flatMap((r) =>
    isPlanOverride(r.override)
      ? [{ email: r.email, override: r.override, createdAt: new Date(r.created_at) }]
      : [],
  );
}

/**
 * Pone la marca de precio especial de una persona (`null` la saca). Devuelve false si no existe esa
 * persona. Solo admin: la app (ADMIN_EMAILS) y la base (`app_admins`) lo verifican; la persona misma no
 * puede escribir su marca (ADR-040). El email no va a los logs ni a la URL.
 */
export async function setPlanOverride(
  userId: string,
  input: { email: string; override: PlanOverride | null },
): Promise<boolean> {
  await assertAdmin(userId);
  const email = normalizeEmail(input.email);
  if (!isValidEmail(email)) return false;
  if (input.override !== null && !isPlanOverride(input.override)) return false;
  const [row] = (await guarded(() =>
    withUser(userId, (tx) =>
      tx.execute(
        sql`select public.admin_plan_override_set(${email}, ${input.override}::text) as ok`,
      ),
    ),
  )) as unknown as { ok: boolean }[];
  return row?.ok === true;
}

export type PendingNotice = {
  id: string;
  email: string;
  plan: string;
  operationNumber: string | null;
  createdAt: Date;
};

/** Avisos «Ya pagué» pendientes, los más viejos primero (R22-02). Solo admin; tope de 100 en la base. */
export async function listPendingNotices(userId: string): Promise<PendingNotice[]> {
  await assertAdmin(userId);
  const rows = (await guarded(() =>
    withUser(userId, (tx) => tx.execute(sql`select * from public.admin_payment_notice_list(100)`)),
  )) as unknown as {
    id: string;
    email: string;
    plan: string;
    operation_number: string | null;
    created_at: Date | string;
  }[];
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    plan: r.plan,
    operationNumber: r.operation_number,
    createdAt: new Date(r.created_at),
  }));
}

export type NoticeResolution = "ya_resuelto" | "no_existe" | "plan_viejo" | "motivo_invalido";

export type ActivateNoticeResult =
  | { ok: true; email: string; until: Date; activated: boolean }
  | { ok: false; reason: NoticeResolution };

/**
 * Activa un aviso pendiente: 30 días desde el último de ahora, la apertura o el vencimiento actual (misma
 * cuenta que `grantBetaPlan`), como pago. La base lo hace en una transacción con el aviso bloqueado: un doble
 * clic o dos admins a la vez activan una sola vez y el segundo recibe `ya_resuelto`.
 */
export async function activatePaymentNotice(
  userId: string,
  noticeId: string,
  now: Date = new Date(),
): Promise<ActivateNoticeResult> {
  await assertAdmin(userId);
  const notice = (await listPendingNotices(userId)).find((n) => n.id === noticeId);
  if (!notice) return { ok: false, reason: "ya_resuelto" };
  const [current] = (await guarded(() =>
    withUser(userId, (tx) => tx.execute(sql`select * from public.admin_plan_get(${notice.email})`)),
  )) as unknown as PlanRowRaw[];
  if (!current) return { ok: false, reason: "no_existe" };
  if (current.plan !== "gratis" && current.plan !== BETA_PLAN) {
    return { ok: false, reason: "plan_viejo" };
  }
  const until = grantPeriod({
    now,
    currentUntil: current.plan === BETA_PLAN ? toDate(current.plan_until) : null,
    days: betaPeriodDays(BETA_PLAN),
  });
  const [res] = (await guarded(() =>
    withUser(userId, (tx) =>
      tx.execute(
        sql`select public.admin_payment_notice_activate(${noticeId}::uuid, ${until.toISOString()}::timestamptz) as r`,
      ),
    ),
  )) as unknown as { r: string }[];
  if (res?.r !== "ok") {
    const reason = res?.r === "plan_viejo" || res?.r === "no_existe" ? res.r : "ya_resuelto";
    return { ok: false, reason };
  }
  return {
    ok: true,
    email: notice.email,
    until,
    activated: isPlanActivation({ plan: current.plan, planUntil: toDate(current.plan_until) }, now),
  };
}

/** Rechaza un aviso pendiente con un motivo corto (ya validado por el pipeline). */
export async function rejectPaymentNotice(
  userId: string,
  noticeId: string,
  reason: string,
): Promise<{ ok: true } | { ok: false; reason: NoticeResolution }> {
  await assertAdmin(userId);
  const [res] = (await guarded(() =>
    withUser(userId, (tx) =>
      tx.execute(sql`select public.admin_payment_notice_reject(${noticeId}::uuid, ${reason}) as r`),
    ),
  )) as unknown as { r: string }[];
  if (res?.r === "ok") return { ok: true };
  const r = res?.r;
  return { ok: false, reason: r === "no_existe" || r === "motivo_invalido" ? r : "ya_resuelto" };
}

export type PlanEventAction = "activar" | "renovar" | "quitar" | "rechazar_aviso" | "marca";

/**
 * Anota un cambio del plan en el historial (R22-02). Es un registro de apoyo: si falla (por ejemplo, la
 * migración todavía no está aplicada) no corta el cambio que ya se hizo; se devuelve `false`.
 */
export async function recordPlanEvent(
  userId: string,
  email: string,
  action: PlanEventAction,
  source: PlanSource | null = null,
): Promise<boolean> {
  try {
    await withUser(userId, (tx) =>
      tx.execute(
        sql`select public.admin_plan_event_add(${normalizeEmail(email)}, ${action}, ${source}::text)`,
      ),
    );
    return true;
  } catch {
    return false;
  }
}

export type PlanEventRow = {
  email: string;
  action: PlanEventAction;
  source: PlanSource | null;
  createdAt: Date;
};

/** Últimos cambios del plan, los más nuevos primero (tope de 50 en la base). */
export async function listPlanEvents(userId: string, limit = 20): Promise<PlanEventRow[]> {
  await assertAdmin(userId);
  const rows = (await guarded(() =>
    withUser(userId, (tx) =>
      tx.execute(sql`select * from public.admin_plan_event_list(${limit}::integer)`),
    ),
  )) as unknown as {
    email: string;
    action: PlanEventAction;
    source: string | null;
    created_at: Date | string;
  }[];
  return rows.map((r) => ({
    email: r.email,
    action: r.action,
    source: isPlanSource(r.source) ? r.source : null,
    createdAt: new Date(r.created_at),
  }));
}

/** Pasa a la persona al plan gratis (sin borrar nada). Devuelve false si no existe o no terminó el onboarding. */
export async function revokePlan(userId: string, emailInput: string): Promise<boolean> {
  await assertAdmin(userId);
  const email = normalizeEmail(emailInput);
  if (!isValidEmail(email)) return false;
  const rows = (await guarded(() =>
    withUser(userId, (tx) =>
      tx.execute(sql`select * from public.admin_plan_set(${email}, 'gratis', null, null)`),
    ),
  )) as unknown as PlanRowRaw[];
  return rows.length === 1;
}
