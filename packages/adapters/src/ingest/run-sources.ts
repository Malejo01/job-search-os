import { schema as s, type Db } from "@job-search-os/db";
import type { CriteriaRules, RawJob, Term } from "@job-search-os/pipeline";
import type { Logger } from "../logger";
import { safeDbError } from "../logging/safe-error";
import { enqueueEvaluationWith } from "../queue/pg-queue";
import { loadTaxonomy } from "../skills/sync";
import { fetchHimalayasJobs } from "../sources/himalayas";
import { fetchRemoteOkJobs } from "../sources/remoteok";
import { fetchTorreJobs } from "../sources/torre";
import { fetchWwrJobs } from "../sources/wwr";
import { ingestBatch, type IngestSummary } from "./ingest-job";
import { loadActiveRules } from "./run-getonboard";

export const SOURCE_NAMES = ["remoteok", "wwr", "himalayas", "torre"] as const;
export type SourceName = (typeof SOURCE_NAMES)[number];

export type SourceDownloader = (args: {
  since: Date;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}) => Promise<RawJob[]>;

export type ExtraSourceDownloaders = Record<SourceName, SourceDownloader>;

/** Tope de páginas bajo para las fuentes que paginan: el cron tiene 60 s en total. */
const MAX_PAGES = 3;

/**
 * Los adapters no conocen el AbortSignal: se inyecta en cada request a través de fetchImpl.
 * Si el fetch (real o falso) ignora la señal, igual se corta la espera con una carrera.
 */
function withSignal(fetchImpl: typeof fetch, signal: AbortSignal | undefined): typeof fetch {
  if (!signal) return fetchImpl;
  return ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    if (signal.aborted) return Promise.reject(new Error("timeout de la fuente"));
    return Promise.race([
      fetchImpl(input, { ...init, signal }),
      new Promise<never>((_, reject) => {
        signal.addEventListener("abort", () => reject(new Error("timeout de la fuente")), {
          once: true,
        });
      }),
    ]);
  }) as typeof fetch;
}

export const EXTRA_SOURCES: ExtraSourceDownloaders = {
  remoteok: async ({ since, fetchImpl, signal }) =>
    (await fetchRemoteOkJobs({ since, fetchImpl: withSignal(fetchImpl ?? fetch, signal) })).jobs,
  wwr: async ({ since, fetchImpl, signal }) =>
    (await fetchWwrJobs({ since, fetchImpl: withSignal(fetchImpl ?? fetch, signal) })).jobs,
  himalayas: async ({ since, fetchImpl, signal }) =>
    (
      await fetchHimalayasJobs({
        since,
        maxPages: MAX_PAGES,
        fetchImpl: withSignal(fetchImpl ?? fetch, signal),
      })
    ).jobs,
  torre: async ({ since, fetchImpl, signal }) =>
    (
      await fetchTorreJobs({
        since,
        maxPages: MAX_PAGES,
        fetchImpl: withSignal(fetchImpl ?? fetch, signal),
      })
    ).jobs,
};

/** Lee `INGEST_EXTRA_SOURCES`: lista separada por coma; vacía o ausente = ninguna. */
export function parseEnabledSources(value: string | undefined): {
  enabled: SourceName[];
  unknown: string[];
} {
  const enabled: SourceName[] = [];
  const unknown: string[] = [];
  const seen = new Set<string>();
  for (const part of (value ?? "").split(",")) {
    const name = part.trim().toLowerCase();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    if ((SOURCE_NAMES as readonly string[]).includes(name)) enabled.push(name as SourceName);
    else unknown.push(name);
  }
  return { enabled, unknown };
}

/**
 * Texto de error apto para la respuesta HTTP del cron: lista cerrada, sin mensajes crudos
 * (un error de base puede traer la consulta, sus parámetros y texto de avisos).
 */
export function safeError(
  e: unknown,
  timedOut = false,
  stage: "descargar" | "ingerir" = "descargar",
): string {
  if (timedOut) return "timeout";
  const message = e instanceof Error ? e.message : "";
  const http = /\bHTTP (\d{3})\b/.exec(message);
  if (http) return `HTTP ${http[1]}`.slice(0, 80);
  if (message === "timeout" || message === "timeout de la fuente") return "timeout";
  return `error al ${stage}`;
}

export type ExtraSourceResult = {
  name: SourceName;
  /** partial: se ingirió para algunos usuarios, pero se acabó el presupuesto o alguno falló. */
  status: "ok" | "partial" | "error" | "skipped";
  fetched: number;
  users: number;
  /** Totales sumados de los usuarios (solo conteos, la respuesta del cron sale en un log público). */
  inserted?: number;
  merged?: number;
  discarded?: number;
  errors?: number;
  /** Texto cerrado: `timeout`, `HTTP <n>`, `error al descargar` o `error al ingerir`. */
  error?: string;
  skipped?: "presupuesto";
};

export type RunExtraSourcesResult = {
  /** false si había fuentes prendidas y todas fallaron. */
  ok: boolean;
  sources: ExtraSourceResult[];
  durationMs: number;
};

export type RunExtraSourcesOptions = {
  db: Db;
  logger: Logger;
  enabled: readonly SourceName[];
  sinceHours?: number;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  /** Tiempo total a partir del cual no arranca otra fuente (default 40 000 ms). */
  budgetMs?: number;
  /** Tope de descarga por fuente (default 10 000 ms). */
  perSourceTimeoutMs?: number;
  /** Por defecto encola en job_queue (evaluate_job). Pasar null para no encolar. */
  enqueueEvaluation?: ((jobId: string, userId: string) => Promise<void>) | null;
  /** Para tests. */
  downloaders?: ExtraSourceDownloaders;
  /** Reloj monotónico en ms, para tests. */
  clock?: () => number;
};

/** Costuras de I/O de la base; los tests las reemplazan. */
export type RunExtraSourcesDeps = {
  loadUsers: () => Promise<{
    users: { userId: string; rules: CriteriaRules }[];
    taxonomy: Term[];
  }>;
  ingest: (jobs: RawJob[], userId: string, rules: CriteriaRules) => Promise<IngestSummary>;
};

function defaultDeps(options: RunExtraSourcesOptions, now: Date): RunExtraSourcesDeps {
  const enqueueEvaluation =
    options.enqueueEvaluation === null
      ? undefined
      : (options.enqueueEvaluation ?? enqueueEvaluationWith(options.db));
  let taxonomy: Term[] = [];
  return {
    loadUsers: async () => {
      const profiles = await options.db.select({ userId: s.profiles.userId }).from(s.profiles);
      taxonomy = await loadTaxonomy(options.db);
      const users: { userId: string; rules: CriteriaRules }[] = [];
      for (const { userId } of profiles) {
        const rules = await loadActiveRules(options.db, userId);
        if (rules) users.push({ userId, rules });
        else options.logger.warn({ user_id: userId }, "fuentes: usuario sin criterios activos");
      }
      return { users, taxonomy };
    },
    ingest: (jobs, userId, rules) =>
      ingestBatch(jobs, {
        db: options.db,
        userId,
        rules,
        logger: options.logger,
        enqueueEvaluation,
        now: () => now,
        taxonomy,
      }),
  };
}

/**
 * Ingesta de las fuentes extra prendidas, en orden y aisladas: un error o un timeout de una no
 * corta a las demás. Si se pasa el presupuesto total, la siguiente no arranca.
 */
export async function runExtraSourcesIngest(
  options: RunExtraSourcesOptions,
  deps?: RunExtraSourcesDeps,
): Promise<RunExtraSourcesResult> {
  const clock = options.clock ?? Date.now;
  const started = clock();
  const now = options.now?.() ?? new Date();
  const since = new Date(now.getTime() - (options.sinceHours ?? 24) * 60 * 60 * 1000);
  const budgetMs = options.budgetMs ?? 40_000;
  const timeoutMs = options.perSourceTimeoutMs ?? 10_000;
  const downloaders = options.downloaders ?? EXTRA_SOURCES;
  const d = deps ?? defaultDeps(options, now);
  const log = options.logger.child({ run_id: `extra-${started}` });

  const sources: ExtraSourceResult[] = [];
  let loaded: Awaited<ReturnType<RunExtraSourcesDeps["loadUsers"]>> | null = null;
  for (const name of options.enabled) {
    const remaining = budgetMs - (clock() - started);
    if (remaining <= 0) {
      log.warn({ source: name }, "fuentes: sin presupuesto de tiempo, se omite");
      sources.push({ name, status: "skipped", fetched: 0, users: 0, skipped: "presupuesto" });
      continue;
    }
    let fetched = 0;
    let stage: "descargar" | "ingerir" = "descargar";
    // El timeout de la descarga nunca pasa lo que queda del presupuesto total.
    const signal = AbortSignal.timeout(Math.min(timeoutMs, remaining));
    try {
      const jobs = await downloaders[name]({ since, fetchImpl: options.fetchImpl, signal });
      fetched = jobs.length;
      if (signal.aborted) {
        // Un adapter puede tragarse el error de una request abortada y devolver lo parcial.
        throw new Error("timeout");
      }
      stage = "ingerir";
      loaded ??= await d.loadUsers();
      let users = 0;
      let failed = 0;
      let cut = false;
      const totals = { inserted: 0, merged: 0, discarded: 0, errors: 0 };
      for (const { userId, rules } of loaded.users) {
        if (clock() - started >= budgetMs) {
          cut = true;
          break;
        }
        try {
          const summary = await d.ingest(jobs, userId, rules);
          log.info(
            { source: name, user_id: userId, ...summary, errors: summary.errors.length },
            "fuentes: ingesta",
          );
          users++;
          totals.inserted += summary.inserted;
          totals.merged += summary.merged;
          totals.discarded += summary.byStatus["prefilter_discard"] ?? 0;
          totals.errors += summary.errors.length;
        } catch (e) {
          failed++;
          log.error(
            { source: name, user_id: userId, err: safeDbError(e) },
            "fuentes: la ingesta de un usuario falló",
          );
        }
      }
      if (users === 0 && cut) {
        sources.push({ name, status: "skipped", fetched, users, skipped: "presupuesto" });
      } else if (users === 0 && failed > 0) {
        sources.push({ name, status: "error", fetched, users, error: "error al ingerir" });
      } else {
        const status = cut || failed > 0 ? "partial" : "ok";
        sources.push({ name, status, fetched, users, ...totals });
      }
    } catch (e) {
      // El mensaje (en Drizzle trae la consulta y sus parámetros) no va al log: solo código y constraint.
      log.error({ source: name, err: safeDbError(e) }, "fuentes: falló");
      sources.push({
        name,
        status: "error",
        fetched,
        users: 0,
        error: safeError(e, stage === "descargar" && signal.aborted, stage),
      });
    }
  }
  const ok = sources.length === 0 || sources.some((s) => s.status !== "error");
  return { ok, sources, durationMs: clock() - started };
}
