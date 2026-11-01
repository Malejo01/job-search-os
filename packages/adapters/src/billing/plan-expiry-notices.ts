import { schema as s, type Db } from "@job-search-os/db";
import {
  buildPlanNoticeEmail,
  EXPIRY_WARNING_DAYS,
  isPlanKey,
  parseContactEmail,
  paymentLink,
  planNoticeDailyCap,
  selectPlanNotices,
  type PlanNoticeCandidate,
} from "@job-search-os/pipeline";
import { and, asc, eq, gt, isNull, lte, ne, sql } from "drizzle-orm";
import { resetUrlBase } from "../auth/reset-url";
import { sendEmail, type SendEmailParams } from "../email/resend";

/**
 * Aviso por email antes de que venza el plan pago (C4-1). Lo dispara el cron diario de
 * `.github/workflows/cron.yml` (step `plan-notices`) contra `/api/cron/plan-notices`.
 *
 * El criterio de «a quién avisar» es de `pipeline/plan-expiry-notice.ts` (puro). Acá está el orden de las
 * cosas, que es lo que lo hace seguro:
 *   1. Sin `RESEND_API_KEY` y `EMAIL_FROM` (o sin URL base) no hace nada: ni lee la base ni marca a nadie.
 *   2. Tope diario: cuenta los avisos marcados hoy (UTC) y no pasa de `PLAN_NOTICE_DAILY_CAP`.
 *   3. Antes de mandar, «reclama» a la persona con un UPDATE condicional sobre `plan_notified_at` y
 *      `plan_until`: si dos corridas se pisan, una sola gana el reclamo y manda. Si el envío falla, se
 *      devuelve la marca anterior y mañana se reintenta.
 * Los logs llevan solo `user_id` y conteos: nunca emails, nombres ni el cuerpo de un error de Resend.
 */

export type NoticeCandidate = PlanNoticeCandidate & {
  email: string;
  displayName: string;
};

/** Lo que el runner necesita de la base. Separado para probar el orden de las cosas sin Postgres. */
export interface NoticeStore {
  /** Personas con plan pago que vence pronto (filtro grueso; el criterio fino es del pipeline). */
  loadCandidates(now: Date): Promise<NoticeCandidate[]>;
  /** Cuántos avisos se marcaron desde `since`. */
  countMarkedSince(since: Date): Promise<number>;
  /** Reclama a la persona para esta corrida. false = otra corrida o un cambio de plan se adelantó. */
  claim(candidate: NoticeCandidate, now: Date): Promise<boolean>;
  /** Devuelve la marca anterior (el envío falló). Solo si la marca sigue siendo la de este reclamo. */
  release(candidate: NoticeCandidate, claimedAt: Date): Promise<void>;
}

export type PlanNoticeLogger = {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
};

export type PlanNoticeRun = {
  ok: true;
  /** Por qué no se hizo nada, si fue así. */
  skipped?: "sin_resend" | "sin_url" | "tope_diario";
  /** Personas que el pipeline eligió para esta corrida. */
  due: number;
  sent: number;
  failed: number;
  /** Eligidas que otra corrida ya había reclamado. */
  raced: number;
  /** Cuántos avisos más caben hoy. */
  capLeft: number;
};

/** Fallos seguidos de Resend después de los cuales se corta la corrida (mañana se reintenta). */
export const MAX_CONSECUTIVE_FAILURES = 5;

/** Inicio del día UTC: la ventana en la que Resend cuenta su límite diario. */
export function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Del error de Resend queda solo el código HTTP: el cuerpo puede traer el email de destino. */
function safeSendError(error: unknown): { status: number | null } {
  const match = /HTTP (\d{3})/.exec(error instanceof Error ? error.message : "");
  return { status: match ? Number(match[1]) : null };
}

export async function runPlanExpiryNotices(deps: {
  store: NoticeStore;
  env: Record<string, string | undefined>;
  now: Date;
  logger: PlanNoticeLogger;
  send?: (params: SendEmailParams, apiKey: string) => Promise<void>;
}): Promise<PlanNoticeRun> {
  const { store, env, now, logger } = deps;
  const send = deps.send ?? ((params, apiKey) => sendEmail(params, apiKey));
  const empty = { due: 0, sent: 0, failed: 0, raced: 0, capLeft: 0 };

  // 1. Sin la configuración de Resend (la key y un remitente propio) no se manda ni se marca nada
  const apiKey = env.RESEND_API_KEY?.trim();
  const from = env.EMAIL_FROM?.trim();
  if (!apiKey || !from) {
    logger.warn({}, "plan-notices: faltan RESEND_API_KEY o EMAIL_FROM; no se manda nada");
    return { ok: true, skipped: "sin_resend", ...empty };
  }
  const base = resetUrlBase(env);
  if (!base.ok) {
    logger.warn({ reason: base.error }, "plan-notices: sin URL base; no se manda nada");
    return { ok: true, skipped: "sin_url", ...empty };
  }

  // 2. Tope diario
  const cap = planNoticeDailyCap(env.PLAN_NOTICE_DAILY_CAP);
  const markedToday = await store.countMarkedSince(startOfUtcDay(now));
  const capLeft = Math.max(0, cap - markedToday);
  if (capLeft === 0) {
    logger.warn({ cap }, "plan-notices: tope diario alcanzado; no se manda nada");
    return { ok: true, skipped: "tope_diario", ...empty };
  }

  const candidates = await store.loadCandidates(now);
  const chosen = selectPlanNotices(candidates, { now, limit: capLeft });
  const contact = parseContactEmail(env.CONTACT_EMAIL);
  const settingsUrl = `${base.url}/settings#tu-plan`;

  let sent = 0;
  let failed = 0;
  let raced = 0;
  let consecutiveFailures = 0;
  for (const candidate of chosen) {
    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      logger.error({ failed }, "plan-notices: demasiados fallos seguidos; se corta la corrida");
      break;
    }
    const log = { user_id: candidate.userId };
    // 3. Reclamo antes del envío: dos corridas a la vez no mandan dos emails
    if (!(await store.claim(candidate, now))) {
      raced++;
      logger.info(log, "plan-notices: otra corrida ya la reclamó");
      continue;
    }
    try {
      const plan = isPlanKey(candidate.plan) ? candidate.plan : null;
      const email = buildPlanNoticeEmail({
        displayName: candidate.displayName,
        until: candidate.planUntil as Date,
        paymentUrl: plan ? paymentLink(env, plan) : null,
        settingsUrl,
        contactEmail: contact,
        becado: candidate.planSource === "beca",
      });
      await send({ to: candidate.email, subject: email.subject, text: email.text, from }, apiKey);
      sent++;
      consecutiveFailures = 0;
      logger.info(log, "plan-notices: aviso enviado");
    } catch (error) {
      failed++;
      consecutiveFailures++;
      logger.error({ ...log, ...safeSendError(error) }, "plan-notices: no se pudo mandar el aviso");
      try {
        await store.release(candidate, now);
      } catch {
        // Queda marcada sin haberse enviado: mejor perder un aviso que mandar dos
        logger.error(log, "plan-notices: no se pudo devolver la marca del aviso");
      }
    }
  }
  return {
    ok: true,
    due: chosen.length,
    sent,
    failed,
    raced,
    capLeft: Math.max(0, capLeft - sent),
  };
}

/** Margen del filtro grueso de la consulta: un día más que la ventana del aviso. */
const LOAD_WINDOW_DAYS = EXPIRY_WARNING_DAYS + 1;
const LOAD_LIMIT = 500;
const DAY_MS = 86_400_000;

/** El store real. Corre con el rol dueño (purpose `service`): ve todos los perfiles y los emails. */
export function createDbNoticeStore(db: Db): NoticeStore {
  return {
    async loadCandidates(now) {
      const rows = await db
        .select({
          userId: s.profiles.userId,
          email: s.users.email,
          displayName: s.profiles.displayName,
          plan: s.profiles.plan,
          planUntil: s.profiles.planUntil,
          planSource: s.profiles.planSource,
          planNotifiedAt: s.profiles.planNotifiedAt,
        })
        .from(s.profiles)
        .innerJoin(s.users, eq(s.users.id, s.profiles.userId))
        .where(
          and(
            ne(s.profiles.plan, "gratis"),
            gt(s.profiles.planUntil, now),
            lte(s.profiles.planUntil, new Date(now.getTime() + LOAD_WINDOW_DAYS * DAY_MS)),
          ),
        )
        .orderBy(asc(s.profiles.planUntil))
        .limit(LOAD_LIMIT);
      return rows;
    },

    async countMarkedSince(since) {
      const [row] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(s.profiles)
        .where(gt(s.profiles.planNotifiedAt, since));
      return row?.n ?? 0;
    },

    async claim(candidate, now) {
      if (!candidate.planUntil) return false;
      const seen = candidate.planNotifiedAt;
      const claimed = await db
        .update(s.profiles)
        .set({ planNotifiedAt: now })
        .where(
          and(
            eq(s.profiles.userId, candidate.userId),
            eq(s.profiles.plan, String(candidate.plan)),
            // El vencimiento y la marca siguen siendo los que leímos (comparación en milisegundos)
            sql`date_trunc('milliseconds', ${s.profiles.planUntil}) = ${candidate.planUntil.toISOString()}::timestamptz`,
            seen
              ? sql`date_trunc('milliseconds', ${s.profiles.planNotifiedAt}) = ${seen.toISOString()}::timestamptz`
              : isNull(s.profiles.planNotifiedAt),
          ),
        )
        .returning({ userId: s.profiles.userId });
      return claimed.length === 1;
    },

    async release(candidate, claimedAt) {
      await db
        .update(s.profiles)
        .set({ planNotifiedAt: candidate.planNotifiedAt })
        .where(
          and(
            eq(s.profiles.userId, candidate.userId),
            sql`date_trunc('milliseconds', ${s.profiles.planNotifiedAt}) = ${claimedAt.toISOString()}::timestamptz`,
          ),
        );
    },
  };
}
