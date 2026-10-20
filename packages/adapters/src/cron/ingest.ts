import type { Db } from "@job-search-os/db";
import { parsePoolLimits } from "@job-search-os/pipeline";
import {
  parseEnabledSources,
  runExtraSourcesIngest,
  type RunExtraSourcesResult,
} from "../ingest/run-sources";
import { runGetOnBoardIngest } from "../ingest/run-getonboard";
import type { Logger } from "../logger";
import { safeDbError } from "../logging/safe-error";
import { buildRoleMarketSnapshots } from "../market/role-snapshot";
import { assignPoolDaily } from "../pool/daily";
import {
  parsePoolSources,
  runPoolFetch,
  type PoolDownloaders,
  type RunPoolFetchResult,
} from "../pool/fetch";
import { sourceUserAgent } from "../sources/user-agent";

/** Resultado de un cron: `ok:false` es lo que la ruta responde como 500 y la CLI como exit 1. */
export type CronRunResult = { ok: boolean; body: Record<string, unknown> };

/** Presupuesto total, medido desde el inicio de la corrida (la ruta de respaldo tiene maxDuration = 120 s). */
export const INGEST_TOTAL_BUDGET_MS = 100_000;
/**
 * Tope del pool dentro de ese presupuesto; las fuentes extra usan lo que quede. 65 s (antes 45 s)
 * por los ATS y WWR (ronda 47); el total sigue acotado por INGEST_TOTAL_BUDGET_MS.
 */
export const INGEST_POOL_BUDGET_MS = 65_000;

/** Pasos de la ingesta que pueden fallar sin cortar la corrida; van en `body.failed`. */
export type IngestStep = "gob" | "pool" | "roles" | "assign" | "extra";

/** `extraSources.ok` es false si todas las prendidas fallaron; el resultado general no cambia. */
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
 * Ingesta programada (la corre el runner de Actions con `pnpm cron:run ingest`; la ruta
 * /api/cron/ingest-getonboard es el respaldo y llama a esta misma función).
 * Corre como servicio (dueño de la base) y filtra por user_id explícito.
 * Orden: (1) Get on Board por usuario, salvo que `getonboard` esté en `POOL_SOURCES` (entonces lo
 * reemplaza el pool; el body lo dice en `gob`), (2) el pool global de ofertas públicas,
 * (3) mercado por rol y asignación diaria del pool a cada usuario, (4) las fuentes de
 * `INGEST_EXTRA_SOURCES` (apagadas por defecto). Cada paso tiene su propio try: un fallo del
 * pool o de la asignación no da `ok:false` si lo demás anduvo.
 */
export async function runIngestCron(opts: {
  db: Db;
  logger: Logger;
  /** Por defecto `process.env`: POOL_SOURCES, INGEST_EXTRA_SOURCES, POOL_*. */
  env?: Record<string, string | undefined>;
  totalBudgetMs?: number;
  poolBudgetMs?: number;
  /** Para tests sin red: se pasa a `runPoolFetch({ downloaders })`. */
  poolDownloaders?: PoolDownloaders;
  now?: () => Date;
}): Promise<CronRunResult> {
  const { db, logger } = opts;
  const env = opts.env ?? process.env;
  const totalBudgetMs = opts.totalBudgetMs ?? INGEST_TOTAL_BUDGET_MS;
  const poolBudgetMs = opts.poolBudgetMs ?? INGEST_POOL_BUDGET_MS;
  const now = opts.now ?? (() => new Date());
  const started = now().getTime();
  const elapsed = () => now().getTime() - started;
  const budgetLeft = () => Math.max(0, totalBudgetMs - elapsed());

  // Pasos que fallaron, con nombres fijos: en el runner pino va en silencio y el body es lo único
  // que se ve (revisión de seguridad de la ronda 62, S-4)
  const failed: IngestStep[] = [];

  const pools = parsePoolSources(env.POOL_SOURCES);
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
      failed.push("gob");
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
        budgetMs: Math.min(poolBudgetMs, budgetLeft()),
        ...(opts.poolDownloaders ? { downloaders: opts.poolDownloaders } : {}),
      });
    } catch (error) {
      // Un fallo del pool no convierte en fallo una corrida de Get on Board que anduvo.
      failed.push("pool");
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
        failed.push("roles");
        logger.error({ err: safeDbError(error) }, "cron mercado por rol falló");
      }
    }
    try {
      const { limits, invalid } = parsePoolLimits(env);
      // Solo el nombre de la variable: nunca su valor
      if (invalid.length > 0) {
        logger.warn({ invalid }, "topes del pool inválidos: se usa el valor por defecto");
      }
      assigned = await assignPoolDaily(db, { logger, limits, budgetMs: budgetLeft() });
    } catch (error) {
      failed.push("assign");
      logger.error({ err: safeDbError(error) }, "cron asignación del pool falló");
    }
  }

  const { enabled, unknown } = parseEnabledSources(env.INGEST_EXTRA_SOURCES, logger);
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
      // Un error de las extras no convierte en fallo una corrida de Get on Board que anduvo.
      failed.push("extra");
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
    ...(failed.length > 0 ? { failed } : {}),
  };
  if (gobFailed) {
    return {
      ok: false,
      body: {
        ok: false,
        error: "ingesta falló",
        ...poolUsers,
        ...poolBody(pool),
        ...extraBody(extra),
        durationMs: elapsed(),
      },
    };
  }
  return {
    ok: true,
    body: {
      ok: true,
      ...poolUsers,
      ...gobBody(gob),
      ...poolBody(pool),
      ...extraBody(extra),
      // Total de la corrida (pisa el `durationMs` de Get on Board, que solo mide ese paso)
      durationMs: elapsed(),
    },
  };
}
