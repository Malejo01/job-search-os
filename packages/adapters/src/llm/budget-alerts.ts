import { createHash } from "node:crypto";
import { schema as s, type Db } from "@job-search-os/db";
import {
  budgetAlertDay,
  budgetAlertIdempotencyKey,
  buildBudgetAlertEmail,
  nextBudgetAlertMemo,
  parseAlertRecipients,
  planBudgetAlerts,
  shouldCheckBudgetAlerts,
  crossedThresholds,
  type BudgetAlertMark,
  type BudgetAlertMemo,
} from "@job-search-os/pipeline";
import { and, eq, like, sql } from "drizzle-orm";
import { resetUrlBase } from "../auth/reset-url";
import { sendEmail, type SendEmailParams } from "../email/resend";
import { dailyCapFromEnv, spendLast24h } from "./spend";

/**
 * Alertas de presupuesto de LLM (R7-1, R8-5): cuando el gasto de 24 h (el mismo que mira el tope global) pasa el
 * 70, el 85 o el 95 % de `LLM_DAILY_CAP_USD`, se manda un email a cada admin de `ADMIN_EMAILS`, **una vez por
 * umbral, por destinatario y por día UTC**. El criterio (qué umbrales, a quién, el texto) es de
 * `pipeline/budget/alerts.ts`.
 *
 * La memoria de «ya se avisó» es una fila marca en `llm_calls` (task `budget_alert`, costo 0, label
 * `<día>:<umbral>:<id del destinatario>`; el id es un hash del email, nunca el email). Sin tabla ni migración. Las
 * marcas de R7-1 (`<día>:<umbral>`, sin destinatario) siguen valiendo para todos. `spend.ts` deja la tarea afuera
 * de los reportes. El orden de las cosas:
 *   1. Sin tope, sin `RESEND_API_KEY`/`EMAIL_FROM` o sin destinatarios no se manda ni se marca nada.
 *   2. Todo corre dentro de un lock por día (`runExclusive`): dos corridas a la vez no mandan lo mismo.
 *   3. Se manda y **recién después** se anota, por destinatario. Un envío que falla no se anota: la próxima
 *      corrida reintenta solo a ese destinatario. Si el proceso muere entre mandar y anotar, la próxima corrida
 *      reenvía con la MISMA clave de idempotencia de Resend (`budget-alert:<día>:<umbral>:<id>`), que Resend
 *      deduplica durante 24 h: no llega dos veces, y nunca queda una marca sin envío.
 * Los logs llevan solo montos y conteos: nunca emails ni el cuerpo de un error de Resend.
 */
export const BUDGET_ALERT_TASK = "budget_alert";
const LOCK_NAMESPACE = 7101;
const SEND_TIMEOUT_MS = 8000;

/** Operaciones sobre las marcas del día; dentro de `runExclusive` comparten transacción y lock. */
export interface BudgetAlertMarks {
  /** Avisos entregados en `day` (`YYYY-MM-DD`, UTC). */
  sentMarks(day: string): Promise<BudgetAlertMark[]>;
  /** Anota que `recipientId` recibió estos umbrales. Idempotente. */
  mark(day: string, thresholds: readonly number[], recipientId: string, now: Date): Promise<void>;
}

/** Lo que el runner necesita de la base. Separado para probar el orden de las cosas sin Postgres. */
export interface BudgetAlertStore extends BudgetAlertMarks {
  /**
   * Corre `fn` con el lock del día tomado. Si otra corrida ya lo tiene devuelve null sin esperar: esa corrida
   * está avisando. Cada `mark` de `fn` es atómico por sí solo: si una falla, las ya anotadas se conservan.
   */
  runExclusive<T>(day: string, fn: (marks: BudgetAlertMarks) => Promise<T>): Promise<T | null>;
}

export type BudgetAlertLogger = {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
};

export type BudgetAlertRun = {
  ok: true;
  skipped?:
    "sin_tope" | "tope_invalido" | "sin_resend" | "sin_destinatarios" | "sin_url" | "en_curso";
  spentUsd: number;
  capUsd: number;
  /** Umbrales que esta corrida avisó (a al menos un destinatario). */
  alerted: number[];
  /** Emails enviados / fallidos. */
  sent: number;
  failed: number;
  /** Umbral más alto que cruzó el gasto (0 si ninguno) y si todos los destinatarios lo tienen. Para el memo. */
  crossedTop: number;
  complete: boolean;
};

/** Del error de Resend queda solo el código HTTP: el cuerpo puede traer el email de destino. */
function safeSendError(error: unknown): { status: number | null } {
  const match = /HTTP (\d{3})/.exec(error instanceof Error ? error.message : "");
  return { status: match ? Number(match[1]) : null };
}

/** Id estable del destinatario para las marcas y la clave de Resend: hash corto del email (no se puede leer de vuelta). */
export function budgetAlertRecipientId(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex").slice(0, 16);
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
  // Con el lock del día tomado no puede quedar colgado el fetch: tope de 8 s por envío (solo para estas alertas)
  const send =
    deps.send ??
    ((params, apiKey) =>
      sendEmail(params, apiKey, (url, init) =>
        fetch(url, { ...init, signal: AbortSignal.timeout(SEND_TIMEOUT_MS) }),
      ));
  const base = {
    spentUsd: 0,
    capUsd: 0,
    alerted: [] as number[],
    sent: 0,
    failed: 0,
    crossedTop: 0,
    complete: true,
  };

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
  const recipients = parseAlertRecipients(env.ADMIN_EMAILS).map((email) => ({
    email,
    id: budgetAlertRecipientId(email),
  }));
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
  const crossedTop = crossedThresholds(spent, cap, []).at(-1) ?? 0;
  const common = { ...base, spentUsd: spent, capUsd: cap, crossedTop };
  if (crossedTop === 0) return { ok: true, ...common };

  const result = await store.runExclusive(day, async (marks) => {
    const plans = planBudgetAlerts({
      spentUsd: spent,
      capUsd: cap,
      recipientIds: recipients.map((r) => r.id),
      marks: await marks.sentMarks(day),
    });
    const alerted = new Set<number>();
    let sent = 0;
    let failed = 0;
    for (const plan of plans) {
      const to = recipients.find((r) => r.id === plan.recipientId)!.email;
      // Un solo email por destinatario, por el umbral más alto que le falta
      const email = buildBudgetAlertEmail({
        threshold: plan.top,
        spentUsd: spent,
        capUsd: cap,
        adminUrl: `${urlBase.url}/settings/salud`,
      });
      try {
        await send(
          {
            to,
            subject: email.subject,
            text: email.text,
            from,
            idempotencyKey: budgetAlertIdempotencyKey(day, plan.top, plan.recipientId),
          },
          apiKey,
        );
      } catch (error) {
        failed++;
        logger.error(
          { ...safeSendError(error), threshold: plan.top },
          "budget-alerts: no se pudo mandar",
        );
        continue; // sin marca: la próxima corrida reintenta solo a este destinatario
      }
      sent++;
      for (const t of plan.thresholds) alerted.add(t);
      try {
        await marks.mark(day, plan.thresholds, plan.recipientId, now);
      } catch {
        // El mail salió: si no se anota, el reintento usa la misma clave de Resend y no llega dos veces
        failed++;
        logger.error({ threshold: plan.top }, "budget-alerts: no se pudo anotar el aviso");
      }
    }
    if (sent > 0) {
      logger.info(
        { thresholds: [...alerted], spent_usd: spent, cap_usd: cap, sent, failed },
        "budget-alerts: aviso enviado",
      );
    }
    return {
      ok: true as const,
      ...common,
      alerted: [...alerted].sort((a, b) => a - b),
      sent,
      failed,
      complete: failed === 0,
    };
  });
  // Lock tomado por otra corrida: ella está avisando; no se da el día por completo para volver a mirar
  if (result === null) return { ok: true, skipped: "en_curso", ...common, complete: false };
  return result;
}

/** Umbrales avisados hoy (UTC) a alguien, para la pantalla de salud. Solo lectura. */
export async function budgetAlertsSentToday(db: Db, now: Date): Promise<number[]> {
  const marks = await createDbBudgetAlertStore(db).sentMarks(budgetAlertDay(now));
  return [...new Set(marks.map((m) => m.threshold))].sort((a, b) => a - b);
}

/** El store real. Corre con la conexión de servicio (ve y escribe `llm_calls` de todos). */
export function createDbBudgetAlertStore(db: Db): BudgetAlertStore {
  type Runner = Pick<Db, "select" | "insert">;
  const labelOf = (day: string, threshold: number, recipientId: string) =>
    `${day}:${threshold}:${recipientId}`;

  type Savepoint = (f: (tx: Runner) => Promise<unknown>) => Promise<unknown>;
  const marksOn = (q: Runner, savepoints?: Savepoint): BudgetAlertMarks => ({
    async sentMarks(day) {
      const rows = await q
        .select({ label: s.llmCalls.label })
        .from(s.llmCalls)
        .where(and(eq(s.llmCalls.task, BUDGET_ALERT_TASK), like(s.llmCalls.label, `${day}:%`)));
      const out: BudgetAlertMark[] = [];
      for (const r of rows) {
        const [, t, rid] = (r.label ?? "").split(":");
        const threshold = Number(t);
        if (Number.isInteger(threshold)) out.push({ recipientId: rid ? rid : null, threshold });
      }
      return out.sort((a, b) => a.threshold - b.threshold);
    },

    async mark(day, thresholds, recipientId, now) {
      const existing = new Set(
        (await this.sentMarks(day))
          .filter((m) => m.recipientId === recipientId)
          .map((m) => m.threshold),
      );
      const rows = thresholds
        .filter((t) => !existing.has(t))
        .map((threshold) => ({
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
          label: labelOf(day, threshold, recipientId),
          ok: true,
          error: null,
          createdAt: now,
        }));
      if (rows.length === 0) return;
      // Un solo INSERT por destinatario (atómico). Dentro del lock va en un savepoint: si falla, Postgres no
      // deja la transacción abortada y las marcas de los destinatarios anteriores se conservan.
      if (savepoints) await savepoints((tx) => tx.insert(s.llmCalls).values(rows));
      else await q.insert(s.llmCalls).values(rows);
    },
  });

  return {
    ...marksOn(db),
    async runExclusive(day, fn) {
      return db.transaction(async (tx) => {
        // Sin esperar: si otra corrida tiene el lock, ella está avisando. Y no se queda una conexión bloqueada.
        const [lock] = (await tx.execute(
          sql`select pg_try_advisory_xact_lock(hashtextextended(${day}, ${LOCK_NAMESPACE})) as ok`,
        )) as unknown as { ok: boolean }[];
        if (!lock?.ok) return null;
        return fn(marksOn(tx, (f) => tx.transaction(f)));
      });
    },
  };
}

/** Atajo para el cron: gasto de 24 h al instante `now`. */
export const spentLast24hUsd = (db: Db, now: Date) => async () =>
  (await spendLast24h(db, () => now)).usd;

/**
 * Revisión del umbral desde las evaluaciones que no pasan por el cron (pegar aviso, reasignación, reenvío de mail).
 * Memo por proceso (día + umbral más alto ya entregado a todos): casi siempre no consulta nada. En serverless el
 * memo es por instancia; la garantía de «una vez por umbral, destinatario y día» es la marca en base. Nunca lanza.
 */
let memo: BudgetAlertMemo | null = null;
let running = false;

export async function checkBudgetAlertsAfterEvaluation(deps: {
  db: Db;
  logger: BudgetAlertLogger;
  env?: Record<string, string | undefined>;
  now?: Date;
  send?: (params: SendEmailParams, apiKey: string) => Promise<void>;
}): Promise<void> {
  const now = deps.now ?? new Date();
  if (running || !shouldCheckBudgetAlerts(memo, now)) return;
  running = true;
  try {
    const res = await runBudgetAlerts({
      store: createDbBudgetAlertStore(deps.db),
      spentUsd: spentLast24hUsd(deps.db, now),
      env: deps.env ?? process.env,
      now,
      logger: deps.logger,
      send: deps.send,
    });
    memo = nextBudgetAlertMemo(budgetAlertDay(now), now, res);
  } catch {
    deps.logger.error({}, "budget-alerts: la revisión tras evaluar falló");
    memo = nextBudgetAlertMemo(budgetAlertDay(now), now, { crossedTop: 0, complete: false });
  } finally {
    running = false;
  }
}

/** Solo para tests: vacía el memo del proceso. */
export function resetBudgetAlertMemoForTests(): void {
  memo = null;
}
