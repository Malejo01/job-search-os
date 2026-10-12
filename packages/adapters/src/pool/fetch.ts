import { schema as s, type Db } from "@job-search-os/db";
import type { RawJob } from "@job-search-os/pipeline";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { Logger } from "../logger";
import { safeDbError } from "../logging/safe-error";
import { sourceErrorCode, type SourceErrorCode } from "../sources/error-code";
import { fetchGetOnBoardJobs, GOB_POOL_CATEGORIES } from "../sources/getonboard";
import { fetchHimalayasJobs } from "../sources/himalayas";
import { fetchJobicyJobs } from "../sources/jobicy";
import { fetchRemoteOkJobs } from "../sources/remoteok";
import { withSignal } from "../sources/with-signal";
import { upsertPoolJobs, type PoolUpsertSummary } from "./upsert";

/**
 * Descarga orquestada del pool global (JS-137). Por fuente: respeta el intervalo mínimo, deja una
 * fila en `public_job_fetches`, descarga con ventana de 48 h y deja que `upsertPoolJobs` escriba
 * en `public_jobs`. Las fuentes corren en orden y aisladas: una que falla no corta a las demás.
 * El resultado sale en el log público del cron: solo conteos y códigos cerrados.
 */
export const POOL_SOURCE_NAMES = ["getonboard", "remoteok", "jobicy", "himalayas"] as const;
export type PoolSourceName = (typeof POOL_SOURCE_NAMES)[number];

/**
 * Fuentes que se recomienda prender, de a una y después del `--dry-run`. NO es un default: sin
 * `POOL_SOURCES` el pool no consulta nada. Himalayas queda afuera por sus términos
 * (docs/sources/himalayas.md).
 */
export const POOL_RECOMMENDED_SOURCES: readonly PoolSourceName[] = [
  "getonboard",
  "remoteok",
  "jobicy",
];

/** Tope de avisos que se procesan por fuente y por corrida. */
export const POOL_MAX_JOBS_PER_SOURCE = 2000;

type SourceKindValue = (typeof s.publicJobFetches.$inferInsert)["sourceKind"];

/** Nombre de la fuente en `POOL_SOURCES` → valor del enum `source_kind` (el de Get on Board difiere). */
export const POOL_SOURCE_KIND: Record<PoolSourceName, SourceKindValue> = {
  getonboard: "getonboard_api",
  remoteok: "remoteok",
  jobicy: "jobicy",
  himalayas: "himalayas",
};

const HOUR_MS = 3_600_000;
/** Con margen: el cron de 6 h no es exacto al minuto. Himalayas: una consulta por día. */
export const POOL_MIN_INTERVAL_MS: Record<PoolSourceName, number> = {
  getonboard: 5 * HOUR_MS,
  remoteok: 5 * HOUR_MS,
  jobicy: 5 * HOUR_MS,
  himalayas: 23 * HOUR_MS,
};

const DEFAULT_TIMEOUT_MS: Record<PoolSourceName, number> = {
  getonboard: 25_000,
  remoteok: 10_000,
  jobicy: 10_000,
  himalayas: 10_000,
};
const HIMALAYAS_MAX_PAGES = 3;

/**
 * Ventana de descarga por fuente (ronda 38). Sin corrida `ok` previa: backfill de
 * `POOL_BACKFILL_DAYS` días (default 14, entero 1 a 30; nunca más que la retención del pool).
 * Con una corrida `ok`: desde su inicio menos 6 h de solapamiento. Una `partial` no cuenta, así
 * que la próxima vuelve a hacer backfill (el upsert es idempotente). Get on Board pagina de a 100
 * con hasta 10 páginas por categoría y corta al llegar a avisos fuera de la ventana: alcanza para
 * 14 días; el límite real es el tope de 2.000 avisos y el presupuesto de tiempo.
 */
export const POOL_BACKFILL_DEFAULT_DAYS = 14;
export const POOL_BACKFILL_MAX_DAYS = 30;
export const POOL_OVERLAP_MS = 6 * HOUR_MS;

export function parsePoolBackfillDays(value: string | undefined): {
  days: number;
  invalid: boolean;
} {
  const raw = value?.trim();
  if (!raw) return { days: POOL_BACKFILL_DEFAULT_DAYS, invalid: false };
  const n = /^\d{1,3}$/.test(raw) ? Number(raw) : NaN;
  if (Number.isInteger(n) && n >= 1 && n <= POOL_BACKFILL_MAX_DAYS)
    return { days: n, invalid: false };
  return { days: POOL_BACKFILL_DEFAULT_DAYS, invalid: true };
}

/** Desde cuándo se descarga una fuente, según su última corrida `ok`. */
export function poolSince(now: Date, lastOkStartedAt: Date | null, backfillDays: number): Date {
  const floor = now.getTime() - POOL_BACKFILL_MAX_DAYS * 24 * HOUR_MS;
  return lastOkStartedAt
    ? new Date(Math.max(lastOkStartedAt.getTime() - POOL_OVERLAP_MS, floor))
    : new Date(now.getTime() - backfillDays * 24 * HOUR_MS);
}

export type PoolErrorCode = SourceErrorCode;

/**
 * Lee `POOL_SOURCES`: sin definir, vacío o solo espacios → ninguna (el pool no consulta nada
 * hasta que se define la variable; así el e2e y el CI no salen a la red); si no, lista separada
 * por coma, sin repetidos; los desconocidos se separan.
 */
export function parsePoolSources(value: string | undefined): {
  enabled: PoolSourceName[];
  unknown: string[];
} {
  if (value === undefined) return { enabled: [], unknown: [] };
  const enabled: PoolSourceName[] = [];
  const unknown: string[] = [];
  const seen = new Set<string>();
  for (const part of value.split(",")) {
    const name = part.trim().toLowerCase();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    if ((POOL_SOURCE_NAMES as readonly string[]).includes(name))
      enabled.push(name as PoolSourceName);
    else unknown.push(name);
  }
  return { enabled, unknown };
}

/** Código de error de lista cerrada: nunca el mensaje crudo. */
export const poolErrorCode = sourceErrorCode;

/** Un descargador devuelve los avisos, o además el error cerrado si cortó a la mitad. */
export type PoolDownload = RawJob[] | { jobs: RawJob[]; partialError?: PoolErrorCode | null };

export type PoolDownloader = (args: {
  since: Date;
  /** Ya trae la señal de timeout inyectada. */
  fetchImpl: typeof fetch;
  userAgent: string;
}) => Promise<PoolDownload>;

export type PoolDownloaders = Record<PoolSourceName, PoolDownloader>;

function normalizeDownload(d: PoolDownload): {
  jobs: RawJob[];
  partialError: PoolErrorCode | null;
} {
  return Array.isArray(d)
    ? { jobs: d, partialError: null }
    : { jobs: d.jobs, partialError: d.partialError ?? null };
}

export const POOL_DOWNLOADERS: PoolDownloaders = {
  getonboard: async ({ since, fetchImpl, userAgent }) => {
    const r = await fetchGetOnBoardJobs({
      since,
      categories: GOB_POOL_CATEGORIES,
      remoteOnly: false,
      skipMissingCategories: true,
      partialOnError: true,
      userAgent,
      fetchImpl,
    });
    return { jobs: r.jobs, partialError: r.partialError };
  },
  remoteok: async ({ since, fetchImpl, userAgent }) =>
    (await fetchRemoteOkJobs({ since, userAgent, fetchImpl })).jobs,
  jobicy: async ({ since, fetchImpl, userAgent }) =>
    (await fetchJobicyJobs({ since, userAgent, fetchImpl })).jobs,
  himalayas: async ({ since, fetchImpl, userAgent }) =>
    (await fetchHimalayasJobs({ since, maxPages: HIMALAYAS_MAX_PAGES, userAgent, fetchImpl })).jobs,
};

export type PoolSourceResult = {
  name: PoolSourceName;
  status: "ok" | "partial" | "error" | "skipped";
  fetched: number;
  inserted?: number;
  updated?: number;
  unchanged?: number;
  copies?: number;
  /** Se recortó a `POOL_MAX_JOBS_PER_SOURCE` avisos. */
  truncated?: true;
  /** Se acabó el presupuesto de tiempo antes de terminar el lote. */
  stopped?: true;
  skipped?: "intervalo" | "presupuesto";
  /** Código cerrado (ver `PoolErrorCode`). */
  error?: PoolErrorCode;
};

export type RunPoolFetchResult = {
  /** false si había fuentes para correr y todas fallaron. */
  ok: boolean;
  sources: PoolSourceResult[];
  durationMs: number;
};

export type RunPoolFetchOptions = {
  db: Db;
  logger: Logger;
  enabled: readonly PoolSourceName[];
  userAgent?: string;
  /** Fuerza la ventana de todas las fuentes (CLI y uso manual); si no, rige backfill / última ok. */
  sinceHours?: number;
  /** Días de backfill; si no viene se lee `POOL_BACKFILL_DAYS` del entorno. */
  backfillDays?: number;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  /** Tiempo total a partir del cual no arranca otra fuente (default 45 000 ms). */
  budgetMs?: number;
  /** Tope de descarga por fuente: 25 000 ms para Get on Board y 10 000 para el resto. */
  perSourceTimeoutMs?: number;
  /** Ignora el intervalo mínimo (tests y uso manual). */
  force?: boolean;
  downloaders?: PoolDownloaders;
  /** Reloj monotónico en ms, para tests. */
  clock?: () => number;
};

export type PoolFetchHistory = {
  /** Inicio de la última corrida `ok` o `partial` (intervalo mínimo). */
  lastGoodStartedAt: Date | null;
  /** Inicio de la última corrida `ok` (ventana de descarga); ausente = ninguna. */
  lastOkStartedAt?: Date | null;
  /** `error_code` de la última corrida de cualquier estado. */
  lastErrorCode: string | null;
};

export type PoolFetchFinish = {
  finishedAt: Date;
  status: "ok" | "partial" | "error";
  httpStatus: number | null;
  fetched: number;
  inserted: number;
  updated: number;
  skipped: number;
  errorCode: PoolErrorCode | null;
  durationMs: number;
};

/** Costuras de I/O de la base; los tests las reemplazan. */
export type RunPoolFetchDeps = {
  upsert: (
    raws: readonly RawJob[],
    opts: { shouldStop: () => boolean },
  ) => Promise<PoolUpsertSummary>;
  lastFetches: (source: PoolSourceName) => Promise<PoolFetchHistory>;
  /** Crea la fila `running` y devuelve su id. */
  recordStart: (source: PoolSourceName, startedAt: Date) => Promise<string>;
  recordFinish: (id: string, finish: PoolFetchFinish) => Promise<void>;
};

function defaultDeps(options: RunPoolFetchOptions, now: Date): RunPoolFetchDeps {
  const { db } = options;
  return {
    upsert: (raws, opts) =>
      upsertPoolJobs(raws, {
        db,
        logger: options.logger,
        now: () => now,
        shouldStop: opts.shouldStop,
      }),
    lastFetches: async (source) => {
      const [good] = await db
        .select({ startedAt: s.publicJobFetches.startedAt })
        .from(s.publicJobFetches)
        .where(
          and(
            eq(s.publicJobFetches.sourceKind, POOL_SOURCE_KIND[source]),
            inArray(s.publicJobFetches.status, ["ok", "partial"]),
          ),
        )
        .orderBy(desc(s.publicJobFetches.startedAt))
        .limit(1);
      const [last] = await db
        .select({ errorCode: s.publicJobFetches.errorCode })
        .from(s.publicJobFetches)
        .where(eq(s.publicJobFetches.sourceKind, POOL_SOURCE_KIND[source]))
        .orderBy(desc(s.publicJobFetches.startedAt))
        .limit(1);
      const [ok] = await db
        .select({ startedAt: s.publicJobFetches.startedAt })
        .from(s.publicJobFetches)
        .where(
          and(
            eq(s.publicJobFetches.sourceKind, POOL_SOURCE_KIND[source]),
            eq(s.publicJobFetches.status, "ok"),
          ),
        )
        .orderBy(desc(s.publicJobFetches.startedAt))
        .limit(1);
      return {
        lastGoodStartedAt: good?.startedAt ?? null,
        lastOkStartedAt: ok?.startedAt ?? null,
        lastErrorCode: last?.errorCode ?? null,
      };
    },
    recordStart: async (source, startedAt) => {
      const [row] = await db
        .insert(s.publicJobFetches)
        .values({ sourceKind: POOL_SOURCE_KIND[source], startedAt, status: "running" })
        .returning({ id: s.publicJobFetches.id });
      return row!.id;
    },
    recordFinish: async (id, f) => {
      await db
        .update(s.publicJobFetches)
        .set({
          finishedAt: f.finishedAt,
          status: f.status,
          httpStatus: f.httpStatus,
          fetched: f.fetched,
          inserted: f.inserted,
          updated: f.updated,
          skipped: f.skipped,
          errorCode: f.errorCode,
          durationMs: f.durationMs,
        })
        .where(eq(s.publicJobFetches.id, id));
    },
  };
}

/** Intervalo efectivo: el mínimo de la fuente, duplicado si la última corrida terminó en 429. */
export function poolIntervalMs(source: PoolSourceName, lastErrorCode: string | null): number {
  return POOL_MIN_INTERVAL_MS[source] * (lastErrorCode === "http_429" ? 2 : 1);
}

export async function runPoolFetch(
  options: RunPoolFetchOptions,
  deps?: RunPoolFetchDeps,
): Promise<RunPoolFetchResult> {
  const clock = options.clock ?? Date.now;
  const started = clock();
  const now = options.now?.() ?? new Date();
  let backfillDays = options.backfillDays;
  if (backfillDays === undefined) {
    const parsed = parsePoolBackfillDays(process.env.POOL_BACKFILL_DAYS);
    backfillDays = parsed.days;
    if (parsed.invalid) {
      options.logger.warn(
        { variable: "POOL_BACKFILL_DAYS", default_days: parsed.days },
        "pool: variable inválida, se usa el default",
      );
    }
  }
  const budgetMs = options.budgetMs ?? 45_000;
  const downloaders = options.downloaders ?? POOL_DOWNLOADERS;
  const userAgent = options.userAgent ?? "JobSearchOS/1.0";
  const d = deps ?? defaultDeps(options, now);
  // El upsert corta entre avisos cuando se acaba el presupuesto total.
  const shouldStop = () => clock() - started >= budgetMs;
  const log = options.logger.child({ run_id: `pool-${started}` });

  const sources: PoolSourceResult[] = [];
  for (const name of options.enabled) {
    const remaining = budgetMs - (clock() - started);
    if (remaining <= 0) {
      log.warn({ source: name }, "pool: sin presupuesto de tiempo, se omite");
      sources.push({ name, status: "skipped", fetched: 0, skipped: "presupuesto" });
      continue;
    }

    let fetched = 0;
    let httpStatus: number | null = null;
    let recordId: string | null = null;
    const sourceStart = clock();
    const sourceStartedAt = new Date(now.getTime() + (sourceStart - started));
    // El timeout de la descarga nunca pasa lo que queda del presupuesto total.
    const signal = AbortSignal.timeout(
      Math.min(options.perSourceTimeoutMs ?? DEFAULT_TIMEOUT_MS[name], remaining),
    );
    let stage: "intervalo" | "descargar" | "ingerir" = "intervalo";
    try {
      // El historial se lee siempre: además del intervalo, define la ventana de descarga
      const history = await d.lastFetches(name);
      const since =
        options.sinceHours !== undefined
          ? new Date(now.getTime() - options.sinceHours * HOUR_MS)
          : poolSince(now, history.lastOkStartedAt ?? null, backfillDays);
      if (!options.force) {
        const interval = poolIntervalMs(name, history.lastErrorCode);
        if (
          history.lastGoodStartedAt &&
          now.getTime() - history.lastGoodStartedAt.getTime() < interval
        ) {
          log.info({ source: name }, "pool: intervalo mínimo sin cumplir, se omite");
          sources.push({ name, status: "skipped", fetched: 0, skipped: "intervalo" });
          continue;
        }
      }

      stage = "descargar";
      recordId = await d.recordStart(name, sourceStartedAt);
      const base = options.fetchImpl ?? fetch;
      const recording = (async (...args: Parameters<typeof fetch>) => {
        const res = await base(...args);
        httpStatus = res.status;
        return res;
      }) as typeof fetch;
      const downloaded = normalizeDownload(
        await downloaders[name]({
          since,
          fetchImpl: withSignal(recording, signal),
          userAgent,
        }),
      );
      fetched = downloaded.jobs.length;
      // Un adapter puede tragarse el error de una request abortada y devolver lo parcial; si no
      // avisó que fue parcial, se trata como timeout.
      if (signal.aborted && !downloaded.partialError) throw new Error("timeout");
      const truncated = downloaded.jobs.length > POOL_MAX_JOBS_PER_SOURCE;
      const jobs = truncated ? downloaded.jobs.slice(0, POOL_MAX_JOBS_PER_SOURCE) : downloaded.jobs;

      stage = "ingerir";
      const summary = await d.upsert(jobs, { shouldStop });
      const worked = summary.inserted + summary.updated + summary.unchanged + summary.copies;
      const incomplete = truncated || summary.stopped === true || downloaded.partialError !== null;
      const status =
        summary.errors > 0 && worked === 0
          ? "error"
          : summary.errors > 0 || incomplete
            ? "partial"
            : "ok";
      const errorCode: PoolErrorCode | null =
        downloaded.partialError ?? (summary.errors > 0 ? "unknown" : null);
      await d.recordFinish(recordId, {
        finishedAt: new Date(now.getTime() + (clock() - started)),
        status,
        httpStatus,
        fetched,
        inserted: summary.inserted,
        updated: summary.updated,
        skipped: summary.skipped,
        errorCode,
        durationMs: clock() - sourceStart,
      });
      log.info({ source: name, ...summary }, "pool: fuente procesada");
      sources.push({
        name,
        status,
        fetched,
        inserted: summary.inserted,
        updated: summary.updated,
        unchanged: summary.unchanged,
        copies: summary.copies,
        ...(truncated ? { truncated: true } : {}),
        ...(summary.stopped === true ? { stopped: true } : {}),
        ...(errorCode ? { error: errorCode } : {}),
      });
    } catch (e) {
      // El mensaje (en Drizzle trae la consulta y sus parámetros) no va al log: solo código y constraint.
      log.error({ source: name, stage, err: safeDbError(e) }, "pool: la fuente falló");
      const errorCode = poolErrorCode(e, stage === "descargar" && signal.aborted);
      if (recordId) {
        try {
          await d.recordFinish(recordId, {
            finishedAt: new Date(now.getTime() + (clock() - started)),
            status: "error",
            httpStatus,
            fetched,
            inserted: 0,
            updated: 0,
            skipped: 0,
            errorCode,
            durationMs: clock() - sourceStart,
          });
        } catch (e2) {
          log.error({ source: name, err: safeDbError(e2) }, "pool: no se pudo cerrar la bitácora");
        }
      }
      sources.push({ name, status: "error", fetched, error: errorCode });
    }
  }
  const ok = sources.length === 0 || sources.some((r) => r.status !== "error");
  return { ok, sources, durationMs: clock() - started };
}
