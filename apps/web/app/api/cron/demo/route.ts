import { createDb, requireDatabaseUrl } from "@job-search-os/db";
import {
  checkBearerSecret,
  createLogger,
  runDemoEvaluations,
  safeDbError,
} from "@job-search-os/adapters";
import { NextResponse } from "next/server";
import { serviceLlm } from "@/lib/llm-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Demo guiada (ronda 74): evalúa los 3 perfiles inventados contra avisos reales del pool y guarda el
 * resultado en demo_evaluations. La página pública solo lee. Lo dispara una vez por semana el workflow
 * de cron (propuesta en ops/rondas/74-demo-guiada) o Mauro a mano. Protegido por CRON_SECRET.
 *
 * Gasto: tope de USD 1 por 7 días con corte en código antes de cada llamada, y 240 s de presupuesto
 * de tiempo; lo que no llega queda para la próxima corrida. Con LLM_DEMO=1 usa el cliente falso.
 * La respuesta solo lleva conteos y gasto.
 */
async function handle(request: Request): Promise<NextResponse> {
  if (
    !checkBearerSecret({
      authorization: request.headers.get("authorization"),
      expected: process.env.CRON_SECRET,
    })
  ) {
    return NextResponse.json({ error: "no autorizado" }, { status: 401 });
  }

  const logger = createLogger({ cron: "demo" });
  let close: (() => Promise<void>) | null = null;
  try {
    const conn = createDb(requireDatabaseUrl({ purpose: "service" }), { max: 2 });
    const db = conn.db;
    close = conn.close;
    const summary = await runDemoEvaluations({ db, llm: serviceLlm(db, logger), logger });
    return NextResponse.json({
      ok: true,
      evaluated: summary.evaluated,
      kept: summary.kept,
      removed: summary.removed,
      skipped: summary.skipped,
      spent_week_usd: Number(summary.spentWeekUsd.toFixed(4)),
      stopped: summary.stopped,
    });
  } catch (error) {
    logger.error({ err: safeDbError(error) }, "cron demo falló");
    return NextResponse.json({ ok: false, error: "demo falló" }, { status: 500 });
  } finally {
    await close?.();
  }
}

export const GET = handle;
export const POST = handle;
