import { createDb, requireDatabaseUrl } from "@job-search-os/db";
import {
  checkBearerSecret,
  createLogger,
  parseEnabledSources,
  runExtraSourcesIngest,
  runGetOnBoardIngest,
  safeDbError,
  type RunExtraSourcesResult,
} from "@job-search-os/adapters";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** De los 60 s de maxDuration, después de esto no arranca otra fuente extra. */
const TOTAL_BUDGET_MS = 40_000;

/** `extraSources.ok` es false si todas las prendidas fallaron; el estado HTTP no cambia. */
function extraBody(extra: RunExtraSourcesResult | null) {
  return extra ? { extraSources: { ok: extra.ok, sources: extra.sources } } : {};
}

/**
 * La respuesta del cron se imprime en un log público (cron.yml): solo agregados, sin `userId`,
 * `externalId` ni mensajes de error. El detalle por usuario queda en los logs del servidor.
 */
function gobBody(gob: Awaited<ReturnType<typeof runGetOnBoardIngest>> | null) {
  if (!gob) return {};
  const totals = { inserted: 0, merged: 0, discarded: 0, enqueued: 0, errors: 0 };
  for (const { summary } of gob.users) {
    totals.inserted += summary.inserted;
    totals.merged += summary.merged;
    totals.discarded += summary.byStatus["prefilter_discard"] ?? 0;
    totals.enqueued += summary.enqueued;
    totals.errors += summary.errors.length;
  }
  return {
    since: gob.since,
    fetched: gob.fetched,
    users: gob.users.length,
    ...totals,
    durationMs: gob.durationMs,
  };
}

/**
 * Cron de ingesta de Get on Board: lo dispara .github/workflows/cron.yml cada 6 hs con
 * `Authorization: Bearer <CRON_SECRET>` (docs/DEPLOY.md); cualquier llamada sin ese header es 401.
 * Corre como servicio (dueño de la base) y filtra por user_id explícito.
 * Después de Get on Board corre las fuentes de `INGEST_EXTRA_SOURCES` (apagadas por defecto).
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

  const started = Date.now();
  const { db, close } = createDb(requireDatabaseUrl({ purpose: "service" }), { max: 2 });
  const logger = createLogger({ cron: "ingest-getonboard" });
  try {
    let gob: Awaited<ReturnType<typeof runGetOnBoardIngest>> | null = null;
    let gobFailed = false;
    try {
      gob = await runGetOnBoardIngest({ db, logger, sinceHours: 24 });
    } catch (error) {
      gobFailed = true;
      logger.error({ err: safeDbError(error) }, "cron ingest falló");
    }

    const { enabled, unknown } = parseEnabledSources(process.env.INGEST_EXTRA_SOURCES);
    if (unknown.length > 0) {
      logger.warn({ unknown }, "INGEST_EXTRA_SOURCES: fuentes desconocidas, se ignoran");
    }
    let extra: RunExtraSourcesResult | null = null;
    if (enabled.length > 0) {
      try {
        extra = await runExtraSourcesIngest({
          db,
          logger,
          enabled,
          sinceHours: 24,
          budgetMs: Math.max(0, TOTAL_BUDGET_MS - (Date.now() - started)),
        });
      } catch (error) {
        // Un error de las extras no convierte en 500 una corrida de Get on Board que anduvo.
        logger.error({ err: safeDbError(error) }, "cron fuentes extra falló");
        extra = {
          ok: false,
          sources: enabled.map((name) => ({
            name,
            status: "error" as const,
            fetched: 0,
            users: 0,
            error: "fuentes extra fallaron",
          })),
          durationMs: 0,
        };
      }
    }

    if (gobFailed) {
      return NextResponse.json(
        { ok: false, error: "ingesta falló", ...extraBody(extra) },
        { status: 500 },
      );
    }
    return NextResponse.json({
      ok: true,
      ...gobBody(gob),
      ...extraBody(extra),
    });
  } finally {
    await close();
  }
}
