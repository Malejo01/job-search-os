import { createDb, requireDatabaseUrl } from "@job-search-os/db";
import {
  checkBearerSecret,
  createDbNoticeStore,
  createLogger,
  runPlanExpiryNotices,
  safeDbError,
} from "@job-search-os/adapters";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Aviso por email antes de que venza el plan pago (C4-1): lo dispara .github/workflows/cron.yml una vez
 * por día. Un solo email por persona y por vencimiento, con tope diario (PLAN_NOTICE_DAILY_CAP) y sin
 * hacer nada si faltan RESEND_API_KEY o EMAIL_FROM. Protegido por CRON_SECRET. La respuesta va al log
 * público de Actions: solo conteos, nunca emails ni ids.
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

  const { db, close } = createDb(requireDatabaseUrl({ purpose: "service" }), { max: 1 });
  const logger = createLogger({ cron: "plan-notices" });
  try {
    const result = await runPlanExpiryNotices({
      store: createDbNoticeStore(db),
      env: process.env,
      now: new Date(),
      logger,
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    logger.error({ err: safeDbError(error) }, "cron plan-notices falló");
    return NextResponse.json({ ok: false, error: "plan-notices falló" }, { status: 500 });
  } finally {
    await close();
  }
}
