import {
  assignPoolToUser,
  createLogger,
  createPgQueue,
  evaluateJobNow,
  hasPoolEvaluationActivity,
  loadPoolEvalCap,
  loadPoolEvalLimit,
  safeDbError,
} from "@job-search-os/adapters";
import { createDb, requireDatabaseUrl } from "@job-search-os/db";
import { parsePoolLimits } from "@job-search-os/pipeline";
import { after } from "next/server";
import { serviceLlm } from "@/lib/llm-service";

/**
 * Reasignación del pool (ronda 41). Concentra los topes de la primera vez y del cambio de puesto
 * para que las acciones no los repitan. Usa la conexión de servicio (como `scheduleFirstIngest`) y
 * `user_id` explícito; los errores se loguean y nunca rompen la acción de la persona.
 */

/** Después de este tiempo desde que arranca el trabajo no se empieza otra evaluación inmediata. */
const FIRST_EVAL_BUDGET_MS = 90_000;

export type ReassignResult = {
  /** Ids de `jobs` encolados, en orden de ranking. */
  enqueuedJobIds: string[];
  /** Verdadero si la persona todavía no había evaluado nada del pool (es la "primera vez"). */
  firstTime: boolean;
};

const NOTHING: ReassignResult = { enqueuedJobIds: [], firstTime: false };

function poolLimits(logger: ReturnType<typeof createLogger>) {
  const { limits, invalid } = parsePoolLimits(process.env);
  if (invalid.length > 0) {
    logger.warn({ invalid }, "topes del pool inválidos: se usa el valor por defecto");
  }
  return limits;
}

/**
 * Salida de Mis skills y guardado de skills en Ajustes. Sin actividad de evaluación del pool,
 * reemplaza lo no tocado y asigna con los topes de la primera vez; con actividad no hace nada.
 */
export async function reassignForSkills(userId: string): Promise<ReassignResult> {
  const logger = createLogger({ user_id: userId, task: "pool_reassign" });
  let conn: ReturnType<typeof createDb> | null = null;
  try {
    conn = createDb(requireDatabaseUrl({ purpose: "service" }), { max: 2 });
    const { db } = conn;
    if (await hasPoolEvaluationActivity(db, userId)) return NOTHING;
    const limits = poolLimits(logger);
    const evalLimit = await loadPoolEvalLimit(db, userId);
    const assigned = await assignPoolToUser(db, userId, {
      limit: limits.firstAssignLimit,
      enqueueTop:
        evalLimit === null ? limits.firstEvalTopN : Math.min(limits.firstEvalTopN, evalLimit),
      replaceUntouched: true,
      deductLast24h: true,
      logger,
    });
    logger.info(
      { assigned: assigned.assigned, replaced: assigned.replaced, enqueued: assigned.enqueued },
      "reasignación por skills",
    );
    return { enqueuedJobIds: assigned.enqueuedJobIds, firstTime: true };
  } catch (e) {
    logger.error({ err: safeDbError(e) }, "la reasignación por skills falló");
    return NOTHING;
  } finally {
    await conn?.close().catch(() => {});
  }
}

/**
 * Cambio de puesto. Sin actividad delega en `reassignForSkills` (la evaluación inmediata la decide
 * quien llama). Con actividad reasigna con los topes diarios y sin evaluación inmediata: la cola la
 * toma el worker del cron. Con `onlyWithActivity` no hace nada si no hay actividad (el reenvío del
 * paso 1: lo cubre la salida de Mis skills).
 */
export async function reassignForRoleChange(
  userId: string,
  opts: { onlyWithActivity?: boolean } = {},
): Promise<ReassignResult> {
  const logger = createLogger({ user_id: userId, task: "pool_reassign" });
  let conn: ReturnType<typeof createDb> | null = null;
  try {
    conn = createDb(requireDatabaseUrl({ purpose: "service" }), { max: 2 });
    const { db } = conn;
    if (!(await hasPoolEvaluationActivity(db, userId))) {
      if (opts.onlyWithActivity) return NOTHING;
      await conn.close().catch(() => {});
      conn = null;
      return await reassignForSkills(userId);
    }
    const limits = poolLimits(logger);
    // Tope propio > el del plan (con PRICING_ENABLED, C-11b) > la variable. Las 9 primeras del
    // onboarding (arriba) no dependen del plan: son la primera impresión
    const evalCap = await loadPoolEvalCap(db, userId, limits.dailyEvalPerUser);
    const assigned = await assignPoolToUser(db, userId, {
      limit: limits.dailyAssignLimit,
      enqueueTop: evalCap,
      replaceUntouched: true,
      deductLast24h: true,
      logger,
    });
    logger.info(
      { assigned: assigned.assigned, replaced: assigned.replaced, enqueued: assigned.enqueued },
      "reasignación por cambio de puesto",
    );
    return { enqueuedJobIds: assigned.enqueuedJobIds, firstTime: false };
  } catch (e) {
    logger.error({ err: safeDbError(e) }, "la reasignación por cambio de puesto falló");
    return NOTHING;
  } finally {
    await conn?.close().catch(() => {});
  }
}

/**
 * Evaluación inmediata, en serie, de las primeras encoladas (después de responder; la persona no
 * espera). Cada una cuenta contra los topes de gasto antes de llamar al modelo: si una vuelve por
 * tope (global o del usuario) o pasan 90 s se corta y el resto queda en la cola para el cron.
 * Corre dentro del maxDuration de la ruta (120 s).
 */
export function scheduleImmediateEvaluation(userId: string, jobIds: string[]): void {
  if (jobIds.length === 0) return;
  after(async () => {
    const startedAt = Date.now();
    const logger = createLogger({ user_id: userId, task: "first_ingest" });
    let conn: ReturnType<typeof createDb> | null = null;
    try {
      conn = createDb(requireDatabaseUrl({ purpose: "service" }), { max: 2 });
      const { db } = conn;
      const llm = serviceLlm(db, logger);
      const queue = createPgQueue(db);
      for (const jobId of jobIds) {
        // Reloj: pasado el tiempo, el resto queda en la cola para el cron (maxDuration 120 s)
        if (Date.now() - startedAt > FIRST_EVAL_BUDGET_MS) {
          logger.info("primera evaluación cortada por tiempo");
          break;
        }
        const jobLogger = createLogger({ user_id: userId, job_id: jobId, task: "first_eval" });
        const result = await evaluateJobNow(jobId, { db, llm, queue, logger: jobLogger });
        if (!result.ran && (result.reason === "cap" || result.reason === "user_cap")) {
          logger.info({ reason: result.reason }, "primera evaluación cortada por tope");
          break;
        }
      }
    } catch (e) {
      logger.error({ err: safeDbError(e) }, "la evaluación inmediata falló");
    } finally {
      await conn?.close().catch(() => {});
    }
  });
}
