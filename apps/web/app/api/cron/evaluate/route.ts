import { createDb, requireDatabaseUrl } from "@job-search-os/db";
import {
  cachedRouteSource,
  createDemoLlm,
  createLlmClient,
  createLogger,
  createPgQueue,
  createProviderRegistry,
  drizzleCallSink,
  drizzleRouteSource,
  runEvaluateWorker,
} from "@job-search-os/adapters";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Worker de evaluación: lo dispara .github/workflows/cron.yml cada 6 hs, después de la ingesta
 * (docs/DEPLOY.md).
 * Procesa hasta 20 mensajes de la cola evaluate_job. Protegido por CRON_SECRET.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "no autorizado" }, { status: 401 });
  }

  const { db, close } = createDb(requireDatabaseUrl({ purpose: "service" }), { max: 2 });
  const logger = createLogger({ cron: "evaluate" });
  try {
    // LLM_DEMO=1 (previews sin key): evaluaciones falsas con model = "fake", badge DEMO en la UI
    const llm =
      process.env.LLM_DEMO === "1"
        ? createDemoLlm({ calls: drizzleCallSink(db) })
        : createLlmClient({
            routes: cachedRouteSource(drizzleRouteSource(db)),
            calls: drizzleCallSink(db),
            providers: createProviderRegistry(),
            logger,
          });
    const summary = await runEvaluateWorker(
      { db, llm, queue: createPgQueue(db), logger },
      { limit: 20 },
    );
    const { outcomes, ...counts } = summary;
    return NextResponse.json({
      ok: true,
      ...counts,
      errors: outcomes
        .filter((o) => !o.ok)
        .map((o) => ({ jobId: o.jobId, error: o.error.slice(0, 200) })),
    });
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
