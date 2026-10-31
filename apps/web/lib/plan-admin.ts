import {
  BETA_PLAN,
  betaPeriodDays,
  grantPeriod,
  isPlanSource,
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
      if (typeof message === "string" && message.includes("admin_plan: no autorizado")) {
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
  | { ok: true; source: PlanSource; until: Date }
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
  return { ok: true, source: input.source, until: toDate(saved.plan_until) ?? until };
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
