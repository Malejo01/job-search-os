import { schema as s, type Db } from "@job-search-os/db";
import type { RawJob } from "@job-search-os/pipeline";
import { and, desc, eq, inArray, max, sql } from "drizzle-orm";
import type { Logger } from "../logger";
import { safeDbError } from "../logging/safe-error";
import { fetchAshbyBoard } from "../sources/ashby";
import {
  atsSourceError,
  atsStatusOf,
  ATS_PROVIDERS,
  ATS_REQUEST_TIMEOUT_MS,
  isPermanentBoardStatus,
  type AtsBoardOptions,
  type AtsBoardResult,
  type AtsBoardStatus,
  type AtsProvider,
} from "../sources/ats-common";
import { sourceErrorCode, type SourceErrorCode } from "../sources/error-code";
import { fetchGetOnBoardJobs, GOB_POOL_CATEGORIES } from "../sources/getonboard";
import { fetchGreenhouseBoard } from "../sources/greenhouse";
import { fetchHimalayasJobs } from "../sources/himalayas";
import { fetchJobicyJobs } from "../sources/jobicy";
import { fetchLeverBoard } from "../sources/lever";
import { fetchRemoteOkJobs, REMOTEOK_API_DELAY_LOOKBACK_MS } from "../sources/remoteok";
import { fetchTeamtailorBoard } from "../sources/teamtailor";
import { fetchWwrJobs, WWR_POOL_CATEGORIES } from "../sources/wwr";
import { upsertPoolJobs, type PoolUpsertSummary } from "./upsert";

/**
 * Descarga orquestada del pool global (JS-137). Por fuente: respeta el intervalo mínimo, deja una
 * fila en `public_job_fetches`, descarga con ventana de 48 h y deja que `upsertPoolJobs` escriba
 * en `public_jobs`. Las fuentes corren en orden y aisladas: una que falla no corta a las demás.
 * El resultado sale en el log público del cron: solo conteos y códigos cerrados.
 */
export const POOL_SOURCE_NAMES = [
  "getonboard",
  "remoteok",
  "jobicy",
  "himalayas",
  "wwr",
  "greenhouse",
  "lever",
  "ashby",
  "teamtailor",
] as const;
export type PoolSourceName = (typeof POOL_SOURCE_NAMES)[number];

/** Las fuentes ATS leen sus boards de `ats_boards` (ronda 47). */
export type PoolAtsSourceName = AtsProvider & PoolSourceName;
export function isAtsSource(name: PoolSourceName): name is PoolAtsSourceName {
  return (ATS_PROVIDERS as readonly string[]).includes(name);
}

/**
 * Fuentes que se recomienda prender, de a una y después del `--dry-run`. NO es un default: sin
 * `POOL_SOURCES` el pool no consulta nada. Himalayas queda afuera por sus términos
 * (docs/sources/himalayas.md).
 */
export const POOL_RECOMMENDED_SOURCES: readonly PoolSourceName[] = [
  "getonboard",
  "remoteok",
  "jobicy",
  "wwr",
  "greenhouse",
  "lever",
  "ashby",
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
  wwr: "wwr",
  greenhouse: "greenhouse",
  lever: "lever",
  ashby: "ashby",
  teamtailor: "teamtailor",
};

const HOUR_MS = 3_600_000;
/** Con margen: el cron de 6 h no es exacto al minuto. Himalayas: una consulta por día. */
export const POOL_MIN_INTERVAL_MS: Record<PoolSourceName, number> = {
  getonboard: 5 * HOUR_MS,
  remoteok: 5 * HOUR_MS,
  jobicy: 5 * HOUR_MS,
  himalayas: 23 * HOUR_MS,
  wwr: 5 * HOUR_MS,
  greenhouse: 5 * HOUR_MS,
  lever: 5 * HOUR_MS,
  ashby: 5 * HOUR_MS,
  teamtailor: 5 * HOUR_MS,
};

/** Los ATS pueden usar hasta 20 s de descarga: el tope real es lo que quede del presupuesto. */
const DEFAULT_TIMEOUT_MS: Record<PoolSourceName, number> = {
  getonboard: 25_000,
  remoteok: 10_000,
  jobicy: 25_000,
  himalayas: 10_000,
  wwr: 20_000,
  greenhouse: 20_000,
  lever: 20_000,
  ashby: 20_000,
  teamtailor: 20_000,
};
/**
 * Tope total de una fuente ATS (descarga más upsert): así una fuente lenta no se come el
 * presupuesto de las demás.
 */
export const POOL_ATS_SOURCE_MAX_MS = 35_000;
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

/** Un board de `ats_boards` listo para descargar. */
export type PoolBoard = {
  id: string;
  token: string;
  region: string | null;
  companyName: string;
  /** Último estado guardado en `ats_boards`: un `not_found` reciente no se vuelve a consultar. */
  lastStatus?: string | null;
  lastFetchAt?: Date | null;
};

/** Un board con `not_found` o `invalid_token` se reintenta una vez por día. */
export const POOL_BROKEN_BOARD_RETRY_MS = 24 * HOUR_MS;

function isBoardDue(b: PoolBoard, now: Date): boolean {
  if (!b.lastStatus || !isPermanentBoardStatus(b.lastStatus as AtsBoardStatus)) return true;
  return !b.lastFetchAt || now.getTime() - b.lastFetchAt.getTime() >= POOL_BROKEN_BOARD_RETRY_MS;
}

/** Resultado de un board intentado: `status` es el código cerrado que se guarda en `last_status`. */
export type PoolBoardOutcome = {
  id: string;
  token: string;
  status: AtsBoardStatus;
  /** Avisos remotos que aportó. */
  fetched: number;
  /** Remotos que quedaron afuera por el tope por board. */
  truncated: number;
  /** Solo Teamtailor: el feed trajo exactamente 100 items y puede estar cortado. */
  feedMaybeTruncated?: true;
};

/**
 * Ids de los boards que se pueden marcar como consultados: los que no tienen avisos (error,
 * `not_found`, 0 remotos) y aquellos cuyos avisos el upsert llegó a EMPEZAR (índice de inicio <
 * `processed`; los avisos se juntan en el orden de los boards). Los que no se tocaron no se marcan
 * y quedan al frente de la cola. Un board a medias sí se marca: así rota al final y no frena para
 * siempre a los demás; lo que quedó sin refrescar tiene margen con la retención de 30 días.
 */
export function boardsStarted(
  outcomes: readonly PoolBoardOutcome[],
  processed: number,
): Set<string> {
  const done = new Set<string>();
  let start = 0;
  for (const o of outcomes) {
    if (o.fetched === 0 || start < processed) done.add(o.id);
    start += o.fetched;
  }
  return done;
}

/** Un descargador devuelve los avisos, o además el error cerrado si cortó a la mitad. */
export type PoolDownload =
  | RawJob[]
  | {
      jobs: RawJob[];
      partialError?: PoolErrorCode | null;
      /** Solo ATS: un resultado por board intentado. */
      boards?: PoolBoardOutcome[];
      /** Solo ATS: quedaron boards sin intentar por falta de tiempo. */
      stopped?: boolean;
      /** Avisos que trajo la fuente antes de filtrar (hoy solo Remote OK). */
      seen?: number;
    };

export type PoolDownloader = (args: {
  since: Date;
  /** Ya trae la señal de timeout inyectada. */
  fetchImpl: typeof fetch;
  userAgent: string;
  /** Solo ATS: filas `enabled` de `ats_boards`, las más viejas primero. */
  boards?: readonly PoolBoard[];
  /**
   * Solo ATS: true cuando a la ventana de descarga le quedan menos de `ATS_REQUEST_TIMEOUT_MS`
   * (el máximo de un request): un board que no va a terminar no se empieza.
   */
  shouldStop?: () => boolean;
  /** Solo ATS: ms que le quedan a la fuente (deadline), para no dormir un backoff que no entra. */
  timeLeftMs?: () => number;
}) => Promise<PoolDownload>;

export type PoolDownloaders = Record<PoolSourceName, PoolDownloader>;

function normalizeDownload(d: PoolDownload): {
  jobs: RawJob[];
  partialError: PoolErrorCode | null;
  boards: PoolBoardOutcome[] | null;
  stopped: boolean;
  seen: number | null;
} {
  return Array.isArray(d)
    ? { jobs: d, partialError: null, boards: null, stopped: false, seen: null }
    : {
        jobs: d.jobs,
        partialError: d.partialError ?? null,
        boards: d.boards ?? null,
        stopped: d.stopped === true,
        seen: d.seen ?? null,
      };
}

/**
 * Como `withSignal`, pero si el adapter ya manda su propia señal (timeout por request) las combina
 * en vez de pisarla: así tanto el tope de la fuente como el de cada request cortan el fetch real.
 */
function withSignalAny(fetchImpl: typeof fetch, signal: AbortSignal): typeof fetch {
  return ((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    if (signal.aborted) return Promise.reject(new Error("timeout de la fuente"));
    return Promise.race([
      fetchImpl(input, {
        ...init,
        signal: init?.signal ? AbortSignal.any([init.signal, signal]) : signal,
      }),
      new Promise<never>((_, reject) => {
        signal.addEventListener("abort", () => reject(new Error("timeout de la fuente")), {
          once: true,
        });
      }),
    ]);
  }) as typeof fetch;
}

const ATS_FETCHERS: Record<AtsProvider, (o: AtsBoardOptions) => Promise<AtsBoardResult>> = {
  greenhouse: fetchGreenhouseBoard,
  lever: fetchLeverBoard,
  ashby: fetchAshbyBoard,
  teamtailor: fetchTeamtailorBoard,
};

/**
 * Recorre los boards en serie. Un board que falla no corta a los demás: queda con su código
 * cerrado. `partialError` es el del primer fallo; si fallaron todos, `runPoolFetch` lo trata como error.
 */
export function atsDownloader(provider: AtsProvider): PoolDownloader {
  // Los ATS ignoran `since`: traen todo lo abierto (hasta `ATS_MAX_JOBS_PER_BOARD` por board).
  return async ({ fetchImpl, userAgent, boards = [], shouldStop, timeLeftMs }) => {
    const jobs: RawJob[] = [];
    const outcomes: PoolBoardOutcome[] = [];
    let stopped = false;
    for (const b of boards) {
      if (shouldStop?.()) {
        stopped = true;
        break;
      }
      try {
        const r = await ATS_FETCHERS[provider]({
          token: b.token,
          region: b.region,
          companyName: b.companyName,
          userAgent,
          fetchImpl,
          timeLeftMs,
        });
        jobs.push(...r.jobs);
        outcomes.push({
          id: b.id,
          token: b.token,
          status: r.status,
          fetched: r.jobs.length,
          truncated: r.truncated,
          ...(r.feedMaybeTruncated ? { feedMaybeTruncated: true as const } : {}),
        });
      } catch (e) {
        outcomes.push({
          id: b.id,
          token: b.token,
          status: atsStatusOf(e),
          fetched: 0,
          truncated: 0,
        });
      }
    }
    // Solo los fallos transitorios cuentan contra la fuente; `not_found` e `invalid_token` quedan
    // en `last_status` del board (un slug mal cargado no puede dejar al proveedor en backfill eterno).
    const firstFailure = outcomes.find(
      (o) => o.status !== "ok" && !isPermanentBoardStatus(o.status),
    );
    return {
      jobs,
      partialError: firstFailure
        ? atsSourceError(firstFailure.status as Exclude<AtsBoardStatus, "ok">)
        : null,
      boards: outcomes,
      stopped,
    };
  };
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
  remoteok: async ({ since, fetchImpl, userAgent }) => {
    // La API publica con ~24 h de demora: se ensancha la ventana y el upsert deduplica.
    const r = await fetchRemoteOkJobs({
      since: new Date(since.getTime() - REMOTEOK_API_DELAY_LOOKBACK_MS),
      userAgent,
      fetchImpl,
    });
    return { jobs: r.jobs, seen: r.seen };
  },
  jobicy: async ({ since, fetchImpl, userAgent }) =>
    (await fetchJobicyJobs({ since, userAgent, fetchImpl })).jobs,
  himalayas: async ({ since, fetchImpl, userAgent }) =>
    (await fetchHimalayasJobs({ since, maxPages: HIMALAYAS_MAX_PAGES, userAgent, fetchImpl })).jobs,
  wwr: async ({ since, fetchImpl, userAgent }) => {
    const r = await fetchWwrJobs({
      since,
      categories: WWR_POOL_CATEGORIES,
      partialOnError: true,
      userAgent,
      fetchImpl,
    });
    return { jobs: r.jobs, partialError: r.partialError ?? null };
  },
  greenhouse: atsDownloader("greenhouse"),
  lever: atsDownloader("lever"),
  ashby: atsDownloader("ashby"),
  teamtailor: atsDownloader("teamtailor"),
};

export type PoolSourceResult = {
  name: PoolSourceName;
  status: "ok" | "partial" | "error" | "skipped";
  fetched: number;
  /** Avisos que trajo la fuente antes de filtrar por fecha; solo cuando el descargador lo informa. */
  seen?: number;
  inserted?: number;
  updated?: number;
  unchanged?: number;
  copies?: number;
  /** Se recortó a `POOL_MAX_JOBS_PER_SOURCE` avisos. */
  truncated?: true;
  /** Se acabó el presupuesto de tiempo antes de terminar el lote. */
  stopped?: true;
  skipped?: "intervalo" | "presupuesto" | "sin_boards";
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
    opts: { shouldStop: () => boolean; timeLeftMs: () => number },
  ) => Promise<PoolUpsertSummary>;
  lastFetches: (source: PoolSourceName) => Promise<PoolFetchHistory>;
  /** Crea la fila `running` y devuelve su id. */
  recordStart: (source: PoolSourceName, startedAt: Date) => Promise<string>;
  recordFinish: (id: string, finish: PoolFetchFinish) => Promise<void>;
  /** Inicio del último intento de cada fuente (de cualquier estado); `null` = nunca intentada. */
  lastAttempts: (
    sources: readonly PoolSourceName[],
  ) => Promise<Partial<Record<PoolSourceName, Date | null>>>;
  /** Boards `enabled` del proveedor, por `last_fetch_at` ascendente (los nunca consultados primero). */
  loadBoards: (provider: AtsProvider) => Promise<PoolBoard[]>;
  /** Actualiza `last_fetch_at` y `last_status` de los boards intentados. */
  updateBoards: (
    updates: readonly { id: string; status: AtsBoardStatus }[],
    at: Date,
  ) => Promise<void>;
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
        timeLeftMs: opts.timeLeftMs,
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
    lastAttempts: async (sources) => {
      const rows = await db
        .select({
          kind: s.publicJobFetches.sourceKind,
          at: max(s.publicJobFetches.startedAt),
        })
        .from(s.publicJobFetches)
        .where(
          inArray(
            s.publicJobFetches.sourceKind,
            sources.map((n) => POOL_SOURCE_KIND[n]),
          ),
        )
        .groupBy(s.publicJobFetches.sourceKind);
      const out: Partial<Record<PoolSourceName, Date | null>> = {};
      for (const n of sources) {
        out[n] = rows.find((r) => r.kind === POOL_SOURCE_KIND[n])?.at ?? null;
      }
      return out;
    },
    loadBoards: (provider) =>
      db
        .select({
          id: s.atsBoards.id,
          token: s.atsBoards.token,
          region: s.atsBoards.region,
          companyName: s.atsBoards.companyName,
          lastStatus: s.atsBoards.lastStatus,
          lastFetchAt: s.atsBoards.lastFetchAt,
        })
        .from(s.atsBoards)
        .where(and(eq(s.atsBoards.provider, provider), eq(s.atsBoards.enabled, true)))
        .orderBy(sql`${s.atsBoards.lastFetchAt} asc nulls first`, s.atsBoards.token),
    updateBoards: async (updates, at) => {
      for (const u of updates) {
        await db
          .update(s.atsBoards)
          .set({ lastFetchAt: at, lastStatus: u.status })
          .where(eq(s.atsBoards.id, u.id));
      }
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
  const totalLeftMs = () => budgetMs - (clock() - started);
  const log = options.logger.child({ run_id: `pool-${started}` });

  // Las fuentes con el intento más viejo van primero (nunca intentadas, antes que todas): así las
  // del final de la lista no pasan hambre cuando el presupuesto no alcanza para todas.
  let order: PoolSourceName[] = [...options.enabled];
  if (order.length > 1) {
    try {
      const attempts = await d.lastAttempts(order);
      const at = (n: PoolSourceName) => attempts[n]?.getTime() ?? -Infinity;
      order = order
        .map((n, i) => ({ n, i }))
        .sort((a, b) => (at(a.n) === at(b.n) ? a.i - b.i : at(a.n) < at(b.n) ? -1 : 1))
        .map((x) => x.n);
    } catch (e) {
      log.warn({ err: safeDbError(e) }, "pool: no se pudo ordenar por último intento");
    }
  }

  const sources: PoolSourceResult[] = [];
  for (const name of order) {
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
    // Tope total de la fuente (descarga + upsert): lo que queda del presupuesto; en los ATS,
    // además, `POOL_ATS_SOURCE_MAX_MS`.
    const sourceLimitMs = isAtsSource(name)
      ? Math.min(remaining, POOL_ATS_SOURCE_MAX_MS)
      : remaining;
    const sourceLeftMs = () => sourceLimitMs - (clock() - sourceStart);
    // El upsert corta entre avisos al pasarse del presupuesto total o del límite de la fuente.
    const shouldStop = () => totalLeftMs() <= 0 || (isAtsSource(name) && sourceLeftMs() <= 0);
    const timeLeftMs = () => Math.max(0, Math.min(totalLeftMs(), sourceLeftMs()));
    // El timeout de la descarga nunca pasa lo que queda de la fuente.
    const sourceTimeoutMs = Math.min(
      options.perSourceTimeoutMs ?? DEFAULT_TIMEOUT_MS[name],
      sourceLimitMs,
    );
    // Una ATS sin lugar para un request no descarga ningún board: se omite sin dejar una corrida
    // vacía, así queda como la más vieja y va primera la próxima vez.
    if (isAtsSource(name) && sourceTimeoutMs < ATS_REQUEST_TIMEOUT_MS) {
      log.warn({ source: name }, "pool: sin ventana de descarga para un board, se omite");
      sources.push({ name, status: "skipped", fetched: 0, skipped: "presupuesto" });
      continue;
    }
    const signal = AbortSignal.timeout(sourceTimeoutMs);
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

      // Los ATS salen de la tabla; sin boards no hay nada que consultar ni que registrar.
      let boards: PoolBoard[] | undefined;
      if (isAtsSource(name)) {
        // Un board roto (not_found / invalid_token) se reintenta una vez por día.
        boards = (await d.loadBoards(name)).filter((b) => isBoardDue(b, now));
        if (boards.length === 0) {
          log.info({ source: name }, "pool: sin boards cargados, se omite");
          sources.push({ name, status: "skipped", fetched: 0, skipped: "sin_boards" });
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
          fetchImpl: withSignalAny(recording, signal),
          userAgent,
          ...(boards
            ? {
                boards,
                timeLeftMs: () => sourceTimeoutMs - (clock() - sourceStart),
                shouldStop: () =>
                  signal.aborted ||
                  sourceTimeoutMs - (clock() - sourceStart) < ATS_REQUEST_TIMEOUT_MS,
              }
            : {}),
        }),
      );
      fetched = downloaded.jobs.length;
      // Solo cuentos por board (el token no es dato personal; los títulos no se loguean).
      const outcomes = downloaded.boards ?? [];
      for (const o of outcomes) {
        log.info(
          {
            source: name,
            token: o.token,
            status: o.status,
            jobs: o.fetched,
            truncated: o.truncated,
            ...(o.feedMaybeTruncated ? { feed_maybe_truncated: true } : {}),
          },
          "pool: board",
        );
      }
      // Fallaron todos y todos por causas transitorias (los permanentes no cuentan contra la fuente).
      const allBoardsFailed =
        outcomes.length > 0 &&
        outcomes.every((o) => o.status !== "ok" && !isPermanentBoardStatus(o.status));
      // Un adapter puede tragarse el error de una request abortada y devolver lo parcial; si no
      // avisó que fue parcial, se trata como timeout.
      if (signal.aborted && !downloaded.partialError) throw new Error("timeout");
      const truncated = downloaded.jobs.length > POOL_MAX_JOBS_PER_SOURCE;
      const jobs = truncated ? downloaded.jobs.slice(0, POOL_MAX_JOBS_PER_SOURCE) : downloaded.jobs;

      stage = "ingerir";
      const summary = await d.upsert(jobs, { shouldStop, timeLeftMs });
      // Después del upsert: si este falla, `last_fetch_at` no avanza y los boards se reintentan.
      const upsertFailed =
        summary.errors > 0 &&
        summary.inserted + summary.updated + summary.unchanged + summary.copies === 0;
      if (outcomes.length > 0 && !upsertFailed) {
        // Cada iteración del upsert suma exactamente un contador; si cortó, lo no recorrido no cuenta.
        const processed =
          summary.inserted +
          summary.updated +
          summary.unchanged +
          summary.copies +
          summary.skipped +
          summary.errors;
        // `outcomes[].fetched` es previo al recorte a POOL_MAX_JOBS_PER_SOURCE: un board que cae
        // entero después del recorte no se marca, y es lo buscado (vuelve a la cabeza de la cola).
        const complete = boardsStarted(outcomes, processed);
        try {
          await d.updateBoards(
            outcomes.filter((o) => complete.has(o.id)).map((o) => ({ id: o.id, status: o.status })),
            new Date(now.getTime() + (clock() - started)),
          );
        } catch (e) {
          log.error(
            { source: name, err: safeDbError(e) },
            "pool: no se pudo actualizar ats_boards",
          );
        }
      }
      const worked = summary.inserted + summary.updated + summary.unchanged + summary.copies;
      const incomplete =
        truncated ||
        summary.stopped === true ||
        downloaded.partialError !== null ||
        downloaded.stopped;
      const status =
        allBoardsFailed || (summary.errors > 0 && worked === 0)
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
      log.info(
        {
          source: name,
          ...(downloaded.seen !== null ? { seen: downloaded.seen } : {}),
          ...summary,
        },
        "pool: fuente procesada",
      );
      sources.push({
        name,
        status,
        fetched,
        ...(downloaded.seen !== null ? { seen: downloaded.seen } : {}),
        inserted: summary.inserted,
        updated: summary.updated,
        unchanged: summary.unchanged,
        copies: summary.copies,
        ...(truncated ? { truncated: true } : {}),
        ...(summary.stopped === true || downloaded.stopped ? { stopped: true } : {}),
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
