import { schema as s, type Db } from "@job-search-os/db";
import {
  budgetAlertDay,
  budgetAlertIdempotencyKey,
  buildBudgetAlertEmail,
  crossedThresholds,
  parseAlertRecipients,
} from "@job-search-os/pipeline";
import { and, eq, like, sql } from "drizzle-orm";
import { resetUrlBase } from "../auth/reset-url";
import { sendEmail, type SendEmailParams } from "../email/resend";
import { dailyCapFromEnv, spendLast24h } from "./spend";

/**
 * Alertas de presupuesto de LLM (R7-1): cuando el gasto de 24 h (el mismo que mira el tope global) pasa el
 * 70, el 85 o el 95 % de `LLM_DAILY_CAP_USD`, se manda un email a `ADMIN_EMAILS`, **una vez por umbral y por
 * día UTC**. El criterio (qué umbrales, el texto) es de `pipeline/budget/alerts.ts`.
 *
 * La memoria de «ya se avisó» es una fila marca en `llm_calls` (task `budget_alert`, label `<día>:<umbral>`,
 * costo 0), el mismo recurso que usa `cv_start`: sin tabla ni migración nuevas. `spend.ts` la deja afuera de
 * los reportes. El orden de las cosas es lo que lo hace seguro:
 *   1. Sin tope, sin `RESEND_API_KEY`/`EMAIL_FROM` o sin destinatarios no se manda ni se marca nada.
 *   2. Antes de mandar se «reclama» el umbral (transacción con lock de asesoría: dos corridas a la vez no
 *      reclaman el mismo). Si ningún envío sale, se devuelve la marca y la próxima corrida reintenta.
 *   3. Refuerzo: la clave de idempotencia de Resend (`budget-alert:<día>:<umbral>:<destinatario>`).
 * Los logs llevan solo montos y conteos: nunca emails ni el cuerpo de un error de Resend.
 */
export const BUDGET_ALERT_TASK = "budget_alert";
const LOCK_NAMESPACE = 7101;

/** Lo que el runner necesita de la base. Separado para probar el orden de las cosas sin Postgres. */
export interface BudgetAlertStore {
  /** Umbrales ya avisados en `day` (`YYYY-MM-DD`, UTC). */
  sentThresholds(day: string): Promise<number[]>;
  /** Reclama el umbral del día. false = otra corrida ya lo reclamó. */
  claim(day: string, threshold: number, now: Date): Promise<boolean>;
  /** Devuelve la marca (el envío falló). */
  release(day: string, threshold: number): Promise<void>;
}

export type BudgetAlertLogger = {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
};

export type BudgetAlertRun = {
  ok: true;
  skipped?: "sin_tope" | "tope_invalido" | "sin_resend" | "sin_destinatarios" | "sin_url";
  spentUsd: number;
  capUsd: number;
  /** Umbrales que esta corrida reclamó y avisó. */
  alerted: number[];
  /** Emails enviados / fallidos. */
  sent: number;
  failed: number;
};

/** Del error de Resend queda solo el código HTTP: el cuerpo puede traer el email de destino. */
function safeSendError(error: unknown): { status: number | null } {
  const match = /HTTP (\d{3})/.exec(error instanceof Error ? error.message : "");
  return { status: match ? Number(match[1]) : null };
}

export async function runBudgetAlerts(deps: {
  store: BudgetAlertStore;
  /** Gasto de las últimas 24 h en USD (el mismo que mira el tope global). */
  spentUsd: () => Promise<number>;
  env: Record<string, string | undefined>;
  now: Date;
  logger: BudgetAlertLogger;
  send?: (params: SendEmailParams, apiKey: string) => Promise<void>;
}): Promise<BudgetAlertRun> {
  const { store, env, now, logger } = deps;
  const send = deps.send ?? ((params, apiKey) => sendEmail(params, apiKey));
  const base = { spentUsd: 0, capUsd: 0, alerted: [] as number[], sent: 0, failed: 0 };

  let cap: number;
  try {
    cap = dailyCapFromEnv(env as NodeJS.ProcessEnv);
  } catch {
    logger.warn({}, "budget-alerts: LLM_DAILY_CAP_USD inválido; no se avisa");
    return { ok: true, skipped: "tope_invalido", ...base };
  }
  if (cap <= 0) return { ok: true, skipped: "sin_tope", ...base };

  const apiKey = env.RESEND_API_KEY?.trim();
  const from = env.EMAIL_FROM?.trim();
  if (!apiKey || !from) {
    logger.warn({}, "budget-alerts: faltan RESEND_API_KEY o EMAIL_FROM; no se avisa");
    return { ok: true, skipped: "sin_resend", ...base, capUsd: cap };
  }
  const recipients = parseAlertRecipients(env.ADMIN_EMAILS);
  if (recipients.length === 0) {
    logger.warn({}, "budget-alerts: ADMIN_EMAILS vacío; no se avisa");
    return { ok: true, skipped: "sin_destinatarios", ...base, capUsd: cap };
  }
  const urlBase = resetUrlBase(env);
  if (!urlBase.ok) {
    logger.warn({ reason: urlBase.error }, "budget-alerts: sin URL base; no se avisa");
    return { ok: true, skipped: "sin_url", ...base, capUsd: cap };
  }

  const spent = await deps.spentUsd();
  const day = budgetAlertDay(now);
  const pending = crossedThresholds(spent, cap, await store.sentThresholds(day));
  if (pending.length === 0) return { ok: true, ...base, spentUsd: spent, capUsd: cap };

  // Reclamo antes del envío: dos corridas a la vez no mandan dos emails por el mismo umbral
  const claimed: number[] = [];
  for (const t of pending) if (await store.claim(day, t, now)) claimed.push(t);
  if (claimed.length === 0) return { ok: true, ...base, spentUsd: spent, capUsd: cap };

  // Si saltó varios umbrales de golpe, un solo email por el más alto
  const top = Math.max(...claimed);
  const email = buildBudgetAlertEmail({
    threshold: top,
    spentUsd: spent,
    capUsd: cap,
    adminUrl: `${urlBase.url}/settings/salud`,
  });
  let sent = 0;
  let failed = 0;
  for (const [i, to] of recipients.entries()) {
    try {
      await send(
        {
          to,
          subject: email.subject,
          text: email.text,
          from,
          idempotencyKey: budgetAlertIdempotencyKey(day, top, i),
        },
        apiKey,
      );
      sent++;
    } catch (error) {
      failed++;
      logger.error({ ...safeSendError(error), threshold: top }, "budget-alerts: no se pudo mandar");
    }
  }
  if (sent === 0) {
    // Nada salió: se devuelven las marcas y la próxima corrida reintenta
    for (const t of claimed) {
      try {
        await store.release(day, t);
      } catch {
        logger.error({ threshold: t }, "budget-alerts: no se pudo devolver la marca");
      }
    }
    return { ok: true, ...base, spentUsd: spent, capUsd: cap, failed };
  }
  logger.info(
    { thresholds: claimed, spent_usd: spent, cap_usd: cap, sent },
    "budget-alerts: aviso enviado",
  );
  return { ok: true, spentUsd: spent, capUsd: cap, alerted: claimed, sent, failed };
}

/** Umbrales avisados hoy (UTC), para la pantalla de salud. Solo lectura. */
export async function budgetAlertsSentToday(db: Db, now: Date): Promise<number[]> {
  return createDbBudgetAlertStore(db).sentThresholds(budgetAlertDay(now));
}

/** El store real. Corre con la conexión de servicio (ve y escribe `llm_calls` de todos). */
export function createDbBudgetAlertStore(db: Db): BudgetAlertStore {
  const labelOf = (day: string, threshold: number) => `${day}:${threshold}`;
  return {
    async sentThresholds(day) {
      const rows = await db
        .select({ label: s.llmCalls.label })
        .from(s.llmCalls)
        .where(and(eq(s.llmCalls.task, BUDGET_ALERT_TASK), like(s.llmCalls.label, `${day}:%`)));
      return rows
        .map((r) => Number((r.label ?? "").split(":")[1]))
        .filter((n) => Number.isInteger(n))
        .sort((a, b) => a - b);
    },

    async claim(day, threshold, now) {
      return db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${day}, ${LOCK_NAMESPACE}))`,
        );
        const label = labelOf(day, threshold);
        const [existing] = await tx
          .select({ id: s.llmCalls.id })
          .from(s.llmCalls)
          .where(and(eq(s.llmCalls.task, BUDGET_ALERT_TASK), eq(s.llmCalls.label, label)))
          .limit(1);
        if (existing) return false;
        await tx.insert(s.llmCalls).values({
          userId: null,
          task: BUDGET_ALERT_TASK,
          model: "none",
          promptVersion: `${BUDGET_ALERT_TASK}@v1`,
          jobId: null,
          tokensIn: null,
          tokensOut: 0,
          tokensReasoning: null,
          latencyMs: 0,
          costUsd: 0,
          label,
          ok: true,
          error: null,
          createdAt: now,
        });
        return true;
      });
    },

    async release(day, threshold) {
      await db
        .delete(s.llmCalls)
        .where(
          and(
            eq(s.llmCalls.task, BUDGET_ALERT_TASK),
            eq(s.llmCalls.label, labelOf(day, threshold)),
          ),
        );
    },
  };
}

/** Atajo para el cron: gasto de 24 h al instante `now`. */
export const spentLast24hUsd = (db: Db, now: Date) => async () =>
  (await spendLast24h(db, () => now)).usd;
