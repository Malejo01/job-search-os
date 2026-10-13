import { createDb, requireDatabaseUrl } from "@job-search-os/db";
import {
  assignPoolDaily,
  buildRoleMarketSnapshots,
  checkBearerSecret,
  createLogger,
  parseEnabledSources,
  parsePoolSources,
  runExtraSourcesIngest,
  runGetOnBoardIngest,
  runPoolFetch,
  safeDbError,
  sourceUserAgent,
  type RunExtraSourcesResult,
  type RunPoolFetchResult,
} from "@job-search-os/adapters";
import { parsePoolLimits } from "@job-search-os/pipeline";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// cron.yml espera hasta 120 s con curl.
export const maxDuration = 120;

/** Presupuesto total, medido desde el inicio del request (maxDuration es 120 s). */
const TOTAL_BUDGET_MS = 100_000;
/**
 * Tope del pool dentro de ese presupuesto; las fuentes extra usan lo que quede. 65 s (antes 45 s)
 * por los ATS y WWR (ronda 47); el total sigue acotado por TOTAL_BUDGET_MS y maxDuration = 120 s.
 */
const POOL_BUDGET_MS = 65_000;

/** `extraSources.ok` es false si todas las prendidas fallaron; el estado HTTP no cambia. */
function extraBody(extra: RunExtraSourcesResult | null) {
  return extra ? { extraSources: { ok: extra.ok, sources: extra.sources } } : {};
}

/** Solo conteos y códigos cerrados por fuente: la respuesta sale en un log público. */
function poolBody(pool: RunPoolFetchResult | null) {
  return pool ? { pool: { ok: pool.ok, sources: pool.sources } } : {};
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
    totals.discarded += summary.byStatus["descartada_prefiltro"] ?? 0;
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
 * Orden: (1) Get on Board por usuario, salvo que `getonboard` esté en `POOL_SOURCES` (entonces lo
 * reemplaza el pool; la respuesta lo dice en `gob`), (2) el pool global de ofertas públicas,
 * (3) mercado por rol y asignación diaria del pool a cada usuario, (4) las fuentes de
 * `INGEST_EXTRA_SOURCES` (apagadas por defecto). Cada paso tiene su propio try: un fallo del
 * pool o de la asignación no da 500 si lo demás anduvo.
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
    const budgetLeft = () => Math.max(0, TOTAL_BUDGET_MS - (Date.now() - started));

    const pools = parsePoolSources(process.env.POOL_SOURCES);
    if (pools.unknown.length > 0) {
      logger.warn({ unknown: pools.unknown }, "POOL_SOURCES: fuentes desconocidas, se ignoran");
    }

    // Con `getonboard` en el pool, el pool reemplaza la ingesta por usuario; si no, sigue como antes
    const gobInPool = pools.enabled.includes("getonboard");
    let gob: Awaited<ReturnType<typeof runGetOnBoardIngest>> | null = null;
    let gobFailed = false;
    if (!gobInPool) {
      try {
        gob = await runGetOnBoardIngest({ db, logger, sinceHours: 24 });
      } catch (error) {
        gobFailed = true;
        logger.error({ err: safeDbError(error) }, "cron ingest falló");
      }
    }

    let pool: RunPoolFetchResult | null = null;
    if (pools.enabled.length > 0) {
      try {
        pool = await runPoolFetch({
          db,
          logger,
          enabled: pools.enabled,
          userAgent: sourceUserAgent(),
          budgetMs: Math.min(POOL_BUDGET_MS, budgetLeft()),
        });
      } catch (error) {
        // Un fallo del pool no convierte en 500 una corrida de Get on Board que anduvo.
        logger.error({ err: safeDbError(error) }, "cron pool falló");
        pool = {
          ok: false,
          sources: pools.enabled.map((name) => ({
            name,
            status: "error" as const,
            fetched: 0,
            error: "unknown" as const,
          })),
          durationMs: 0,
        };
      }
    }

    // Del pool a los usuarios: mercado por rol y asignación diaria (cada paso en su propio try)
    let roles: number | null = null;
    let assigned: Awaited<ReturnType<typeof assignPoolDaily>> | null = null;
    if (pools.enabled.length > 0) {
      const poolChanged = Boolean(
        pool?.sources.some((src) => (src.inserted ?? 0) + (src.updated ?? 0) > 0),
      );
      if (poolChanged) {
        try {
          roles = (await buildRoleMarketSnapshots(db)).roles;
        } catch (error) {
          logger.error({ err: safeDbError(error) }, "cron mercado por rol falló");
        }
      }
      try {
        const { limits, invalid } = parsePoolLimits(process.env);
        // Solo el nombre de la variable: nunca su valor
        if (invalid.length > 0) {
          logger.warn({ invalid }, "topes del pool inválidos: se usa el valor por defecto");
        }
        assigned = await assignPoolDaily(db, { logger, limits, budgetMs: budgetLeft() });
      } catch (error) {
        logger.error({ err: safeDbError(error) }, "cron asignación del pool falló");
      }
    }

    const { enabled, unknown } = parseEnabledSources(process.env.INGEST_EXTRA_SOURCES, logger);
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
          budgetMs: budgetLeft(),
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

    const poolUsers = {
      gob: gobInPool ? ("pool" as const) : ("por_usuario" as const),
      ...(roles !== null ? { roles } : {}),
      ...(assigned ? { assigned } : {}),
    };
    if (gobFailed) {
      return NextResponse.json(
        {
          ok: false,
          error: "ingesta falló",
          ...poolUsers,
          ...poolBody(pool),
          ...extraBody(extra),
        },
        { status: 500 },
      );
    }
    return NextResponse.json({
      ok: true,
      ...poolUsers,
      ...gobBody(gob),
      ...poolBody(pool),
      ...extraBody(extra),
    });
  } finally {
    await close();
  }
}
