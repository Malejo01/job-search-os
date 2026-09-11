import { createDb, requireDatabaseUrl } from "@job-search-os/db";
import { createLogger, runGetOnBoardIngest } from "@job-search-os/adapters";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Cron de ingesta de Get on Board: lo dispara .github/workflows/cron.yml cada 6 hs con
 * `Authorization: Bearer <CRON_SECRET>` (docs/DEPLOY.md); cualquier llamada sin ese header es 401.
 * Corre como servicio (dueño de la base) y filtra por user_id explícito.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "no autorizado" }, { status: 401 });
  }

  const { db, close } = createDb(requireDatabaseUrl({ purpose: "service" }), { max: 2 });
  const logger = createLogger({ cron: "ingest-getonboard" });
  try {
    const result = await runGetOnBoardIngest({ db, logger, sinceHours: 24 });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    logger.error(
      { err: error instanceof Error ? error.message : String(error) },
      "cron ingest falló",
    );
    return NextResponse.json({ ok: false, error: "ingesta falló" }, { status: 500 });
  } finally {
    await close();
  }
}
