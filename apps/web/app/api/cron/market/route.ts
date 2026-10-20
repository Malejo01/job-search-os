import { createDb, requireDatabaseUrl } from "@job-search-os/db";
import { checkBearerSecret, createLogger, runMarketCron } from "@job-search-os/adapters";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Respaldo del snapshot semanal de mercado + plan de formación (JS-031/JS-034, sin LLM). Desde la
 * ronda 62 el cron lo reemplaza por `pnpm cron:run market` desde el runner de Actions; la lógica
 * vive en `runMarketCron` (packages/adapters/src/cron). Protegido por CRON_SECRET.
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
  const logger = createLogger({ cron: "market" });
  try {
    const { ok, body } = await runMarketCron({ db, logger });
    return NextResponse.json(body, { status: ok ? 200 : 500 });
  } finally {
    await close();
  }
}
