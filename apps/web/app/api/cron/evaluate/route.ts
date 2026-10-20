import { createDb, requireDatabaseUrl } from "@job-search-os/db";
import {
  buildEvaluateCronResponse,
  checkBearerSecret,
  failedOutcomes,
  createLogger,
  createPgQueue,
  EVALUATE_BUDGET_MS,
  parseLogDays,
  purgeExpired,
  purgePool,
  runEvaluateWorker,
  safeDbError,
} from "@job-search-os/adapters";
import { NextResponse } from "next/server";
import { serviceLlm } from "@/lib/llm-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Mensajes de la cola que procesa cada corrida (cada 6 h). Subió de 20 a 50 con el pool (ronda 37). */
const EVALUATE_LIMIT = 50;

/**
 * Worker de evaluación: lo dispara .github/workflows/cron.yml cada 6 hs, después de la ingesta
 * (docs/DEPLOY.md).
 * Procesa hasta EVALUATE_LIMIT mensajes de la cola evaluate_job. Protegido por CRON_SECRET.
 */
export async function GET(request: Request): Promise<NextResponse> {
  if (
    !checkBearerSecret({
      authorization: request.headers.get("authorization"),
      expected: process.env.CRON_SECRET,
    })
  ) {
    return NextResponse.json({ error: "no autorizado" }, { status: 401 });
  }

  const { db, close } = createDb(requireDatabaseUrl({ purpose: "service" }), { max: 2 });
  const logger = createLogger({ cron: "evaluate" });
  try {
    const llm = serviceLlm(db, logger);
    const summary = await runEvaluateWorker(
      { db, llm, queue: createPgQueue(db), logger },
      { limit: EVALUATE_LIMIT, budgetMs: EVALUATE_BUDGET_MS },
    );
    // El detalle (ids y mensaje) va al log del servidor; la respuesta es pública (cron.yml): JS-110
    for (const f of failedOutcomes(summary.outcomes)) {
      logger.warn(
        { job_id: f.jobId, category: f.category, err: f.message },
        "evaluación fallida en el cron",
      );
    }
    // Purga de filas técnicas vencidas (JS-107): si falla, el cron no se rompe. La respuesta pública lleva solo el total; el desglose va al log.
    let purged: number | null = null;
    try {
      const detail = await purgeExpired(db, {
        now: new Date(),
        logDays: parseLogDays(process.env.LEGAL_LOG_DAYS),
      });
      purged = detail.tokens + detail.llmCalls + detail.queue + detail.rejections;
      logger.info({ purged: detail }, "purga de retención");
    } catch (error) {
      logger.error({ err: safeDbError(error) }, "purga de retención falló");
    }
    // Retención del pool global (30 días desde la última vez visto): en su propio try, no rompe el cron.
    // La respuesta pública lleva solo el conteo de avisos.
    let purgedPool: number | null = null;
    try {
      const detail = await purgePool(db);
      purgedPool = detail.jobs;
      logger.info({ purged_pool: detail }, "purga del pool");
    } catch (error) {
      logger.error({ err: safeDbError(error) }, "purga del pool falló");
    }
    return NextResponse.json({
      ...buildEvaluateCronResponse(summary),
      stopped_by_budget: summary.stopped === "budget",
      purged,
      purgedPool,
    });
  } catch (error) {
    logger.error({ err: safeDbError(error) }, "cron evaluate falló");
    return NextResponse.json({ ok: false, error: "worker falló" }, { status: 500 });
  } finally {
    await close();
  }
}
