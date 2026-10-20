import { createDb, requireDatabaseUrl } from "@job-search-os/db";
import { checkBearerSecret, createLogger, runIngestCron } from "@job-search-os/adapters";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// El respaldo manual espera hasta 120 s.
export const maxDuration = 120;

/**
 * Respaldo del cron de ingesta (Get on Board, pool, mercado por rol, asignación y fuentes extra).
 * Desde la ronda 62 el cron lo reemplaza por `pnpm cron:run ingest` desde el runner de Actions; la
 * lógica vive en `runIngestCron` (packages/adapters/src/cron) y esta ruta solo la envuelve.
 * Cualquier llamada sin `Authorization: Bearer <CRON_SECRET>` es 401.
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
  const logger = createLogger({ cron: "ingest-getonboard" });
  try {
    const { ok, body } = await runIngestCron({ db, logger });
    return NextResponse.json(body, { status: ok ? 200 : 500 });
  } finally {
    await close();
  }
}
