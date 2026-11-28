import { schema as s, type Db } from "@job-search-os/db";
import {
  REEVALUATION_OPEN_STATUSES,
  decideNextReevaluation,
  err,
  estimateReevaluationUsd,
  ok,
  perCallReevaluationUsd,
  selectReevaluationCandidates,
  type JobStatus,
  type ReevaluationRow,
  type Result,
} from "@job-search-os/pipeline";
import type { PromptRef } from "@job-search-os/prompts";
import { desc, eq, inArray, sql } from "drizzle-orm";
import type { LlmClient } from "../llm/types";
import type { Logger } from "../logger";
import { createPgQueue } from "../queue/pg-queue";
import { evaluateJobById } from "../worker/evaluate-job";

/**
 * Reevaluación única (R31-09): vuelve a evaluar, una sola vez, las ofertas abiertas con la versión nueva de
 * `evaluate_job` cuando ya está promovida. Así no conviven dos formatos de evaluación.
 *
 * - **`execute: false` (dry-run) es el default**: cuenta cuántas son y estima el gasto, sin llamar a ningún modelo
 *   y sin escribir nada (ni la base ni el archivo de estado).
 * - **Tope de gasto obligatorio** para ejecutar (`maxUsd`): antes de cada oferta se mira lo gastado más lo que se
 *   estima que cuesta; si no entra, se frena. Lo que falta queda para retomar.
 * - **Se puede cortar y retomar:** después de cada oferta se guarda el estado (`ReevalStore`). Una corrida nueva con
 *   la misma versión sigue por las que faltan; las fallidas se reintentan.
 * - **Guarda la evaluación anterior:** las evaluaciones no se pisan (cada una es una fila y la pantalla muestra la
 *   última), y el estado anota, por oferta, la evaluación previa, la nueva y el estado y las marcas de la oferta
 *   antes de tocarla. `rollbackReevaluation` borra las nuevas y restaura eso: la anterior vuelve a ser la última.
 *
 * Datos personales: el estado solo lleva ids, puntajes, versiones y modelos; nunca texto de avisos ni de perfiles.
 */
export type ReevalPrevious = {
  evaluationId: string;
  score: number;
  promptVersion: string;
  model: string;
  createdAt: string;
};

export type ReevalEntry = {
  userId: string;
  previous: ReevalPrevious;
  /** Estado y marcas de la oferta antes de reevaluar (la evaluación puede cambiar `flags`). */
  job: { status: string; flags: string[] };
  state: "done" | "failed" | "rolled_back" | "kept";
  next?: { evaluationId: string; score: number; promptVersion: string };
  costUsd: number | null;
  /** Solo para `failed`: un motivo corto. */
  error?: string;
};

export type ReevalState = {
  version: 1;
  runId: string;
  promptVersion: string;
  startedAt: string;
  maxUsd: number;
  spentUsd: number;
  entries: Record<string, ReevalEntry>;
};

/** Dónde se guarda el estado: un archivo en la CLI, la memoria en los tests. */
export interface ReevalStore {
  load(): Promise<ReevalState | null>;
  save(state: ReevalState): Promise<void>;
}

export function memoryReevalStore(initial: ReevalState | null = null): ReevalStore & {
  current: () => ReevalState | null;
  saves: () => number;
} {
  let state = initial ? structuredClone(initial) : null;
  let saves = 0;
  return {
    async load() {
      return state ? structuredClone(state) : null;
    },
    async save(next) {
      state = structuredClone(next);
      saves++;
    },
    current: () => (state ? structuredClone(state) : null),
    saves: () => saves,
  };
}

export type ReevalError =
  { kind: "max_usd_obligatorio" } | { kind: "estado_de_otra_version"; stateVersion: string };

export type ReevalReport = {
  mode: "dry-run" | "execute";
  promptVersion: string;
  counts: {
    todo: number;
    upToDate: number;
    alreadyDone: number;
    notEligible: number;
    deferred: number;
  };
  perCallUsd: number | null;
  estimatedUsd: number | null;
  maxUsd: number | null;
  /** ¿El tope alcanza para todo lo estimado? `null` sin tope o sin estimado. */
  fitsInCap: boolean | null;
  evaluated: number;
  failed: number;
  spentUsd: number;
  stopped: "cap" | "signal" | null;
  /** Ofertas que quedaron sin hacer por haber frenado. */
  remaining: number;
  /** Antes y después de lo hecho en esta corrida (solo ids y puntajes). */
  comparison: { jobId: string; before: number; after: number }[];
};

export type ReevalDeps = {
  db: Db;
  llm: LlmClient;
  logger: Logger;
  store: ReevalStore;
  now?: () => Date;
  signal?: AbortSignal;
};

type LatestRow = ReevaluationRow & {
  flags: string[];
  previous: ReevalPrevious | null;
};

/** Las ofertas abiertas con su última evaluación, en un orden estable. */
async function loadRows(db: Db): Promise<LatestRow[]> {
  const latest = db
    .selectDistinctOn([s.evaluations.jobId], {
      jobId: s.evaluations.jobId,
      id: s.evaluations.id,
      score: s.evaluations.score,
      promptVersion: s.evaluations.promptVersion,
      model: s.evaluations.model,
      createdAt: s.evaluations.createdAt,
    })
    .from(s.evaluations)
    .orderBy(s.evaluations.jobId, desc(s.evaluations.createdAt))
    .as("latest");
  const rows = await db
    .select({
      jobId: s.jobs.id,
      userId: s.jobs.userId,
      status: s.jobs.status,
      flags: s.jobs.flags,
      evaluationId: latest.id,
      score: latest.score,
      promptVersion: latest.promptVersion,
      model: latest.model,
      createdAt: latest.createdAt,
    })
    .from(s.jobs)
    .leftJoin(latest, eq(latest.jobId, s.jobs.id))
    .where(inArray(s.jobs.status, REEVALUATION_OPEN_STATUSES as JobStatus[]))
    .orderBy(s.jobs.id);
  return rows.map((r) => ({
    jobId: r.jobId,
    userId: r.userId,
    status: r.status,
    lastPromptVersion: r.promptVersion ?? null,
    flags: r.flags ?? [],
    previous:
      r.evaluationId && r.score !== null && r.promptVersion && r.model && r.createdAt
        ? {
            evaluationId: r.evaluationId,
            score: r.score,
            promptVersion: r.promptVersion,
            model: r.model,
            createdAt: r.createdAt.toISOString(),
          }
        : null,
  }));
}

async function loadPerCallUsd(db: Db): Promise<number | null> {
  const [route] = await db
    .select({ inUsd: s.modelRouting.inputUsdPerMtok, outUsd: s.modelRouting.outputUsdPerMtok })
    .from(s.modelRouting)
    .where(eq(s.modelRouting.task, "evaluate_job"));
  return perCallReevaluationUsd(route ?? null);
}

const shortError = (e: string): string => e.replace(/\s+/g, " ").slice(0, 120);

export async function runReevaluation(
  deps: ReevalDeps,
  opts: {
    promptVersion: string;
    execute: boolean;
    maxUsd?: number;
    limit?: number;
    runId?: string;
  },
): Promise<Result<ReevalReport, ReevalError>> {
  const { db, store } = deps;
  const log = deps.logger.child({ task: "reevaluate" });
  if (opts.execute && (opts.maxUsd === undefined || !(opts.maxUsd > 0))) {
    return err({ kind: "max_usd_obligatorio" });
  }
  const saved = await store.load();
  if (saved && saved.promptVersion !== opts.promptVersion) {
    return err({ kind: "estado_de_otra_version", stateVersion: saved.promptVersion });
  }

  const rows = await loadRows(db);
  const byId = new Map(rows.map((r) => [r.jobId, r]));
  const done = new Set(
    Object.entries(saved?.entries ?? {})
      .filter(([, e]) => e.state === "done" || e.state === "kept")
      .map(([id]) => id),
  );
  const selection = selectReevaluationCandidates(rows, {
    promptVersion: opts.promptVersion,
    done,
    ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
  });
  const perCallUsd = await loadPerCallUsd(db);
  const estimatedUsd = estimateReevaluationUsd(selection.todo.length, perCallUsd);

  const report: ReevalReport = {
    mode: opts.execute ? "execute" : "dry-run",
    promptVersion: opts.promptVersion,
    counts: {
      todo: selection.todo.length,
      upToDate: selection.upToDate.length,
      alreadyDone: selection.alreadyDone.length,
      notEligible: selection.notEligible.length,
      deferred: selection.deferred.length,
    },
    perCallUsd,
    estimatedUsd,
    maxUsd: opts.maxUsd ?? null,
    fitsInCap:
      opts.maxUsd !== undefined && estimatedUsd !== null ? estimatedUsd <= opts.maxUsd : null,
    evaluated: 0,
    failed: 0,
    spentUsd: saved?.spentUsd ?? 0,
    stopped: null,
    remaining: 0,
    comparison: [],
  };
  if (!opts.execute) return ok(report);

  const now = deps.now ?? (() => new Date());
  const state: ReevalState = saved ?? {
    version: 1,
    runId: opts.runId ?? `reeval-${opts.promptVersion}-${now().toISOString().slice(0, 10)}`,
    promptVersion: opts.promptVersion,
    startedAt: now().toISOString(),
    maxUsd: opts.maxUsd!,
    spentUsd: 0,
    entries: {},
  };
  // El tope de ESTA corrida manda sobre el guardado; lo gastado se acumula entre cortes
  state.maxUsd = opts.maxUsd!;
  await store.save(state);

  const queue = createPgQueue(db);
  for (const [index, candidate] of selection.todo.entries()) {
    if (deps.signal?.aborted) {
      report.stopped = "signal";
      report.remaining = selection.todo.length - index;
      break;
    }
    const next = decideNextReevaluation({
      spentUsd: state.spentUsd,
      maxUsd: state.maxUsd,
      estimateUsd: perCallUsd,
    });
    if (!next.ok) {
      report.stopped = "cap";
      report.remaining = selection.todo.length - index;
      break;
    }
    const row = byId.get(candidate.jobId)!;
    const previous = row.previous!; // selectReevaluationCandidates exige una evaluación previa
    const entryBase = {
      userId: row.userId,
      previous,
      job: { status: row.status, flags: row.flags },
    };
    const outcome = await evaluateJobById(candidate.jobId, {
      db,
      llm: deps.llm,
      queue,
      logger: log,
      promptVersion: opts.promptVersion as PromptRef,
      ...(deps.now ? { now: deps.now } : {}),
      ...(deps.signal ? { signal: deps.signal } : {}),
    });
    if (outcome.ok) {
      const cost = outcome.costUsd ?? perCallUsd ?? 0;
      state.spentUsd += cost;
      state.entries[candidate.jobId] = {
        ...entryBase,
        state: "done",
        next: {
          evaluationId: outcome.evaluationId,
          score: outcome.score,
          promptVersion: opts.promptVersion,
        },
        costUsd: outcome.costUsd,
      };
      report.evaluated++;
      report.comparison.push({
        jobId: candidate.jobId,
        before: previous.score,
        after: outcome.score,
      });
    } else {
      state.entries[candidate.jobId] = {
        ...entryBase,
        state: "failed",
        costUsd: null,
        error: shortError(outcome.error),
      };
      report.failed++;
    }
    await store.save(state);
  }
  report.spentUsd = state.spentUsd;
  log.info(
    {
      evaluated: report.evaluated,
      failed: report.failed,
      spent_usd: Number(state.spentUsd.toFixed(4)),
      stopped: report.stopped,
    },
    "reevaluación",
  );
  return ok(report);
}

export type RollbackReport = {
  mode: "dry-run" | "execute";
  restorable: number;
  restored: number;
  /** No se restauran: la persona ya opinó sobre la evaluación nueva o la anterior ya no está. */
  kept: { jobId: string; reason: "con_opinion" | "sin_evaluacion_nueva" | "sin_anterior" }[];
};

/**
 * Vuelve atrás una reevaluación: borra las evaluaciones nuevas de la corrida y restaura el estado y las marcas de
 * cada oferta, así la evaluación anterior vuelve a ser la última. Dry-run por defecto. No toca una evaluación
 * nueva sobre la que la persona ya dio una opinión (👍/👎 o puntaje propio): se informa y queda.
 */
export async function rollbackReevaluation(
  deps: Pick<ReevalDeps, "db" | "store" | "logger">,
  opts: { execute: boolean },
): Promise<Result<RollbackReport, { kind: "sin_estado" }>> {
  const { db, store } = deps;
  const state = await store.load();
  if (!state) return err({ kind: "sin_estado" });
  const report: RollbackReport = {
    mode: opts.execute ? "execute" : "dry-run",
    restorable: 0,
    restored: 0,
    kept: [],
  };
  for (const [jobId, entry] of Object.entries(state.entries)) {
    if (entry.state !== "done" || !entry.next) continue;
    const [fresh] = await db
      .select({
        id: s.evaluations.id,
        verdict: s.evaluations.humanVerdict,
        score: s.evaluations.humanScore,
      })
      .from(s.evaluations)
      .where(eq(s.evaluations.id, entry.next.evaluationId));
    const [before] = await db
      .select({ id: s.evaluations.id })
      .from(s.evaluations)
      .where(eq(s.evaluations.id, entry.previous.evaluationId));
    if (!fresh) {
      report.kept.push({ jobId, reason: "sin_evaluacion_nueva" });
      continue;
    }
    if (!before) {
      report.kept.push({ jobId, reason: "sin_anterior" });
      continue;
    }
    if (fresh.verdict !== null || fresh.score !== null) {
      report.kept.push({ jobId, reason: "con_opinion" });
      if (opts.execute) entry.state = "kept";
      continue;
    }
    report.restorable++;
    if (!opts.execute) continue;
    await db.transaction(async (tx) => {
      await tx.delete(s.evaluations).where(eq(s.evaluations.id, entry.next!.evaluationId));
      await tx
        .update(s.jobs)
        .set({
          status: entry.job.status as JobStatus,
          flags: entry.job.flags,
          updatedAt: sql`now()`,
        })
        .where(eq(s.jobs.id, jobId));
    });
    entry.state = "rolled_back";
    report.restored++;
    await store.save(state);
  }
  if (opts.execute) await store.save(state);
  return ok(report);
}
