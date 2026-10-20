import { createDb, requireDatabaseUrl } from "@job-search-os/db";
import {
  checkBearerSecret,
  createLogger,
  evaluateStatus,
  readStatusSnapshot,
  safeDbError,
  statusExpectedSecret,
} from "@job-search-os/adapters";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * GET /api/cron/status (ronda 69, I-6): estado operativo para un monitor externo (docs/MONITOREO.md).
 * Auth `Authorization: Bearer`: si STATUS_TOKEN está definido acepta solo ese (para no darle el
 * secret del cron a un tercero); si no, CRON_SECRET. Responde solo agregados; 503 si algún check falla.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const authorization = request.headers.get("authorization");
  // Con STATUS_TOKEN definido rige solo ese: así el secret del cron nunca tiene que salir a un tercero
  const expected = statusExpectedSecret({
    STATUS_TOKEN: process.env.STATUS_TOKEN,
    CRON_SECRET: process.env.CRON_SECRET,
  });
  if (!checkBearerSecret({ authorization, expected })) {
    return NextResponse.json({ error: "no autorizado" }, { status: 401, headers: NO_STORE });
  }

  const { db, close } = createDb(requireDatabaseUrl({ purpose: "service" }), { max: 1 });
  const logger = createLogger({ cron: "status" });
  try {
    const now = new Date();
    const report = evaluateStatus(await readStatusSnapshot(db, now), now);
    if (!report.ok) {
      // Solo nombres de checks: nada de datos de usuarios
      logger.warn(
        { failing: report.checks.filter((c) => !c.ok).map((c) => c.name) },
        "status: hay checks fallando",
      );
    }
    return NextResponse.json(report, { status: report.ok ? 200 : 503, headers: NO_STORE });
  } catch (error) {
    logger.error({ err: safeDbError(error) }, "cron status falló");
    return NextResponse.json(
      { ok: false, error: "status falló" },
      { status: 503, headers: NO_STORE },
    );
  } finally {
    await close();
  }
}
