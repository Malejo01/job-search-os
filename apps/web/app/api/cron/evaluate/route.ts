import { createDb, requireDatabaseUrl } from "@job-search-os/db";
import {
  buildEvaluateCronResponse,
  checkBearerSecret,
  failedOutcomes,
  createLogger,
  createPgQueue,
  runEvaluateWorker,
} from "@job-search-os/adapters";
import { NextResponse } from "next/server";
import { serviceLlm } from "@/lib/llm-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Worker de evaluación: lo dispara .github/workflows/cron.yml cada 6 hs, después de la ingesta
 * (docs/DEPLOY.md).
 * Procesa hasta 20 mensajes de la cola evaluate_job. Protegido por CRON_SECRET.
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
      { limit: 20 },
    );
    // El detalle (ids y mensaje) va al log del servidor; la respuesta es pública (cron.yml): JS-110
    for (const f of failedOutcomes(summary.outcomes)) {
      logger.warn(
        { job_id: f.jobId, category: f.category, err: f.message },
        "evaluación fallida en el cron",
      );
    }
    return NextResponse.json(buildEvaluateCronResponse(summary));
  } catch (error) {
    logger.error(
      { err: error instanceof Error ? error.message : String(error) },
      "cron evaluate falló",
    );
    return NextResponse.json({ ok: false, error: "worker falló" }, { status: 500 });
  } finally {
    await close();
  }
}
