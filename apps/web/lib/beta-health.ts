import {
  budgetAlertsSentToday,
  createLogger,
  dailyCapFromEnv,
  safeDbError,
  spendLast24h,
} from "@job-search-os/adapters";
import { createDb, requireDatabaseUrl } from "@job-search-os/db";
import type { BetaHealthInput } from "@job-search-os/pipeline";
import { sql } from "drizzle-orm";
import { unstable_cache } from "next/cache";
import { canCreateInvitations } from "./invitations";

/**
 * Salud diaria de la beta (C8-11), solo servidor y solo admins (ADMIN_EMAILS). Lee conteos agregados
 * entre personas, así que va por la conexión de servicio (como los topes de gasto de `evaluate-now`):
 * una sola consulta de subconsultas `count`/`sum` sobre índices existentes, con `statement_timeout` de
 * 3 s, y el resultado se cachea 5 minutos. Nunca devuelve filas, ids, emails ni textos de nadie.
 */
type Raw = {
  queue_pending: number | string;
  queue_oldest: Date | string | null;
  resets_today: number | string;
  notices_today: number | string;
  feedback_today: number | string;
  received_today: number | string;
  inbound_errors: number | string;
  pool_errors: number | string;
  active_today: number | string;
  feedback_24h: number | string;
};

/** Inicio del día de hoy en Argentina (UTC−3, sin horario de verano), para «activas hoy». */
function startOfArgentinaDay(now: Date): Date {
  const ar = new Date(now.getTime() - 3 * 3_600_000);
  return new Date(Date.UTC(ar.getUTCFullYear(), ar.getUTCMonth(), ar.getUTCDate()) + 3 * 3_600_000);
}

function adminCount(): number {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean).length;
}

async function readCounts(
  nowIso: string,
): Promise<(Raw & { llm_spent: number; budget_alerts: number[] }) | null> {
  const now = new Date(nowIso);
  const arDay = startOfArgentinaDay(now).toISOString();
  const { db, close } = createDb(requireDatabaseUrl({ purpose: "service" }), { max: 1 });
  try {
    const rows = (await db.transaction(async (tx) => {
      await tx.execute(sql`set local statement_timeout = '3s'`);
      return tx.execute(sql`
        select
          (select count(*) from job_queue
            where queue = 'evaluate_job' and status in ('pending', 'processing')) as queue_pending,
          (select min(created_at) from job_queue
            where queue = 'evaluate_job' and status = 'pending') as queue_oldest,
          (select count(*) from password_reset_tokens
            where created_at >= date_trunc('day', now(), 'UTC')) as resets_today,
          (select count(*) from profiles
            where plan_notified_at >= date_trunc('day', now(), 'UTC')) as notices_today,
          (select count(*) from beta_feedback
            where created_at >= date_trunc('day', now(), 'UTC')) as feedback_today,
          (select count(*) from inbound_emails
            where received_at >= date_trunc('day', now(), 'UTC')) as received_today,
          (select count(*) from inbound_emails
            where error is not null and received_at > now() - interval '24 hours') as inbound_errors,
          (select count(*) from public_job_fetches
            where status = 'error' and started_at > now() - interval '24 hours') as pool_errors,
          (select count(distinct user_id) from (
            select e.user_id from evaluations e where e.human_verdict_at >= ${arDay}::timestamptz
            union all
            select a.user_id from applications a where a.created_at >= ${arDay}::timestamptz
            union all
            select j.user_id from jobs j
              where j.created_at >= ${arDay}::timestamptz and j.public_job_id is null
          ) x) as active_today,
          (select count(*) from beta_feedback
            where created_at > now() - interval '24 hours') as feedback_24h
      `);
    })) as unknown as Raw[];
    if (!rows[0]) return null;
    // El mismo gasto que mira el tope global (spend.ts): todas las llamadas al modelo de 24 h
    const spend = await spendLast24h(db, () => now);
    // Umbrales de presupuesto ya avisados hoy (R7-1)
    const alerts = await budgetAlertsSentToday(db, now);
    return { ...rows[0], llm_spent: spend.usd, budget_alerts: alerts };
  } finally {
    await close();
  }
}

// Cinco minutos: la pantalla se mira a la mañana; recargar no vuelve a pegarle a la base
const cachedCounts = unstable_cache(readCounts, ["beta-health"], { revalidate: 300 });

export type BetaHealthResult =
  | { ok: true; input: BetaHealthInput; at: Date; budgetAlertsToday: number[] }
  | { ok: false; reason: "no_admin" | "sin_datos" };

export async function getBetaHealth(userId: string): Promise<BetaHealthResult> {
  if (!(await canCreateInvitations(userId).catch(() => false))) {
    return { ok: false, reason: "no_admin" };
  }
  // La clave del caché es el minuto: dentro de 5 min devuelve lo mismo
  const now = new Date();
  now.setSeconds(0, 0);
  try {
    const raw = await cachedCounts(
      new Date(now.getTime() - (now.getMinutes() % 5) * 60_000).toISOString(),
    );
    if (!raw) return { ok: false, reason: "sin_datos" };
    const n = (v: number | string | null) => Number(v ?? 0);
    // Mismo tope que el worker: sin la variable rige el default (USD 2); 0 = sin tope
    let cap: number | null = null;
    try {
      cap = dailyCapFromEnv(process.env);
    } catch {
      cap = null;
    }
    const input: BetaHealthInput = {
      now: new Date(),
      queue: {
        pending: n(raw.queue_pending),
        oldestPendingAt: raw.queue_oldest ? new Date(raw.queue_oldest) : null,
      },
      llm: { spent24hUsd: raw.llm_spent, capUsd: cap && cap > 0 ? cap : null },
      emails: {
        // Soporte: un email por cada admin de ADMIN_EMAILS por reporte. La bienvenida (C8-7) no se registra
        sentToday:
          n(raw.resets_today) +
          n(raw.notices_today) +
          n(raw.feedback_today) * Math.max(adminCount(), 1),
        receivedToday: n(raw.received_today),
      },
      ingestErrors24h: { inbound: n(raw.inbound_errors), pool: n(raw.pool_errors) },
      activeToday: n(raw.active_today),
      feedback24h: n(raw.feedback_24h),
    };
    return { ok: true, input, at: now, budgetAlertsToday: raw.budget_alerts ?? [] };
  } catch (e) {
    createLogger({ user_id: userId, task: "beta_health" }).error(
      { err: safeDbError(e) },
      "salud de la beta: no se pudo leer",
    );
    return { ok: false, reason: "sin_datos" };
  }
}
