import { schema as s, type Db } from "@job-search-os/db";
import type { CriteriaRules } from "@job-search-os/pipeline";
import { and, desc, eq } from "drizzle-orm";
import type { Logger } from "../logger";
import { enqueueEvaluationWith } from "../queue/pg-queue";
import { fetchGetOnBoardJobs, GOB_CATEGORIES } from "../sources/getonboard";
import { loadTaxonomy } from "../skills/sync";
import { ingestBatch, type IngestSummary } from "./ingest-job";

export type RunGobOptions = {
  db: Db;
  logger: Logger;
  /** Ventana hacia atrás (default 24 h). */
  sinceHours?: number;
  categories?: readonly string[];
  /** Solo este usuario; por defecto todos los perfiles con criterios activos. */
  userId?: string;
  /** Por defecto encola en job_queue (evaluate_job). Pasar null para no encolar. */
  enqueueEvaluation?: ((jobId: string, userId: string) => Promise<void>) | null;
  fetchImpl?: typeof fetch;
  now?: () => Date;
};

export type RunGobResult = {
  since: string;
  fetched: { jobs: number; pagesFetched: number; seen: number };
  users: { userId: string; summary: IngestSummary }[];
  durationMs: number;
};

/**
 * Corrida de ingesta de Get on Board para todos los usuarios (o uno): una sola descarga,
 * dedup/prefiltro por usuario. La usan el cron (app/api/cron/ingest-getonboard) y el CLI.
 */
export async function runGetOnBoardIngest(options: RunGobOptions): Promise<RunGobResult> {
  const started = Date.now();
  const now = options.now?.() ?? new Date();
  const since = new Date(now.getTime() - (options.sinceHours ?? 24) * 60 * 60 * 1000);
  const log = options.logger.child({ run_id: `gob-${started}` });
  const enqueueEvaluation =
    options.enqueueEvaluation === null
      ? undefined
      : (options.enqueueEvaluation ?? enqueueEvaluationWith(options.db));

  const fetched = await fetchGetOnBoardJobs({
    since,
    categories: options.categories ?? GOB_CATEGORIES,
    fetchImpl: options.fetchImpl,
  });
  log.info(
    { jobs: fetched.jobs.length, pages: fetched.pagesFetched, seen: fetched.seen, since },
    "gob: descarga",
  );

  const profiles = await options.db
    .select({ userId: s.profiles.userId })
    .from(s.profiles)
    .where(options.userId ? eq(s.profiles.userId, options.userId) : undefined);

  const taxonomy = await loadTaxonomy(options.db);
  const users: RunGobResult["users"] = [];
  for (const { userId } of profiles) {
    const [criteria] = await options.db
      .select({ rules: s.evaluationCriteria.rules })
      .from(s.evaluationCriteria)
      .where(and(eq(s.evaluationCriteria.userId, userId), eq(s.evaluationCriteria.active, true)))
      .orderBy(desc(s.evaluationCriteria.version))
      .limit(1);
    if (!criteria) {
      log.warn({ user_id: userId }, "gob: usuario sin criterios activos, se omite");
      continue;
    }
    const summary = await ingestBatch(fetched.jobs, {
      db: options.db,
      userId,
      rules: criteria.rules as CriteriaRules,
      logger: log,
      enqueueEvaluation,
      now: () => now,
      taxonomy,
    });
    log.info({ user_id: userId, ...summary, errors: summary.errors.length }, "gob: ingesta");
    users.push({ userId, summary });
  }

  return {
    since: since.toISOString(),
    fetched: { jobs: fetched.jobs.length, pagesFetched: fetched.pagesFetched, seen: fetched.seen },
    users,
    durationMs: Date.now() - started,
  };
}
