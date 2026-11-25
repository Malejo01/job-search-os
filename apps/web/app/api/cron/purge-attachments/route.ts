import { createDb, requireDatabaseUrl } from "@job-search-os/db";
import { checkBearerSecret, createLogger, safeDbError } from "@job-search-os/adapters";
import { ATTACHMENT_PURGE_DAYS, attachmentsPurgeEnabled } from "@job-search-os/pipeline";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Limpieza diaria de adjuntos de lo ya resuelto (R29-09). Borra los archivos de los ítems en «resuelto» desde hace
 * 30 días o más (`purge_resolved_attachments`, rls/0070); el texto del ítem no se toca nunca. Protegido por
 * `CRON_SECRET` y apagado por defecto: sin `ATTACHMENTS_PURGE_ENABLED=1` no hace nada. La respuesta va al log
 * público de Actions: solo conteos, nunca nombres ni ids de personas.
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
  const runId = randomUUID();
  const logger = createLogger({ cron: "purge-attachments", run_id: runId });
  if (!attachmentsPurgeEnabled(process.env)) {
    logger.info({}, "limpieza de adjuntos apagada");
    return NextResponse.json(
      { ok: true, enabled: false, run_id: runId },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const { db, close } = createDb(requireDatabaseUrl({ purpose: "service" }), { max: 1 });
  try {
    const rows = (await db.execute(
      sql`select * from purge_resolved_attachments(${ATTACHMENT_PURGE_DAYS}::integer)`,
    )) as unknown as { files_deleted: number; bytes_freed: number | string }[];
    const files = Number(rows[0]?.files_deleted ?? 0);
    const bytes = Number(rows[0]?.bytes_freed ?? 0);
    logger.info({ files, bytes }, "limpieza de adjuntos");
    return NextResponse.json(
      { ok: true, enabled: true, run_id: runId, files, bytes },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    logger.error({ err: safeDbError(error) }, "cron purge-attachments falló");
    return NextResponse.json(
      { ok: false, run_id: runId, error: "purge-attachments falló" },
      { status: 500 },
    );
  } finally {
    await close();
  }
}
