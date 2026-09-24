import { schema as s, type Db } from "@job-search-os/db";
import {
  buildEvaluateJobVars,
  canTransition,
  decide,
  outputSchemaFor,
  transition,
  type CriteriaRules,
  type JobStatus,
} from "@job-search-os/pipeline";
import type { PromptRef } from "@job-search-os/prompts";
import { and, desc, eq } from "drizzle-orm";
import { DEFAULT_PROMPT_VERSIONS } from "../llm/client";
import type { LlmClient } from "../llm/types";
import { dailyCapFromEnv, spendLast24h } from "../llm/spend";
import type { Logger } from "../logger";
import { EVALUATE_QUEUE, type EvaluatePayload, type Queue } from "../queue/pg-queue";

/**
 * Worker de evaluación: toma mensajes de la cola, evalúa con el LLM (prompt vigente en
 * DEFAULT_PROMPT_VERSIONS), aplica decide() en código, guarda `evaluations` y transiciona
 * jobs.status con transition(). Corre como servicio y filtra por user_id explícito.
 */
export type EvaluateDeps = {
  db: Db;
  llm: LlmClient;
  queue: Queue;
  logger: Logger;
  promptVersion?: PromptRef;
  now?: () => Date;
  /** Cancela la llamada LLM en curso y corta el loop del worker (SIGINT/SIGTERM). */
  signal?: AbortSignal;
};

export type EvaluateOutcome =
  | {
      ok: true;
      jobId: string;
      evaluationId: string;
      costUsd: number | null;
      score: number;
      accion: string;
      status: JobStatus;
    }
  | { ok: false; jobId: string; error: string; retry: "retry" | "failed" | "skipped" };

const titleCapFromFlags = (flags: readonly string[] | null | undefined): number | null => {
  for (const f of flags ?? []) {
    const m = /^title_cap:(\d+(?:\.\d+)?)$/.exec(f);
    if (m) return Number(m[1]);
  }
  return null;
};

/** Evalúa un job por id (fuera de la cola: útil para JS-017 "pegar JD" y para tests). */
export async function evaluateJobById(jobId: string, deps: EvaluateDeps): Promise<EvaluateOutcome> {
  const { db } = deps;
  const promptVersion =
    deps.promptVersion ?? DEFAULT_PROMPT_VERSIONS.evaluate_job ?? "evaluate_job@v1";
  const log = deps.logger.child({ job_id: jobId });

  const [job] = await db.select().from(s.jobs).where(eq(s.jobs.id, jobId)).limit(1);
  if (!job) return { ok: false, jobId, error: "job inexistente", retry: "failed" };
  if (!job.jdText?.trim()) {
    return { ok: false, jobId, error: "job sin jd_text: no se evalúa", retry: "skipped" };
  }
  // Cerrada/descartada después de encolar (JS-017): no gastar una llamada en algo que no puede transicionar
  if (!canTransition(job.status, "evaluated")) {
    return {
      ok: false,
      jobId,
      error: `job en estado ${job.status}: no se evalúa`,
      retry: "skipped",
    };
  }
  const [profile] = await db.select().from(s.profiles).where(eq(s.profiles.userId, job.userId));
  const [criteria] = await db
    .select()
    .from(s.evaluationCriteria)
    .where(and(eq(s.evaluationCriteria.userId, job.userId), eq(s.evaluationCriteria.active, true)))
    .orderBy(desc(s.evaluationCriteria.version))
    .limit(1);
  if (!profile || !criteria) {
    return { ok: false, jobId, error: "usuario sin perfil o criterios activos", retry: "failed" };
  }
  const rules = criteria.rules as CriteriaRules;

  const vars = buildEvaluateJobVars({
    profile: {
      profileSummary: profile.profileSummary ?? "",
      locationCountry: profile.locationCountry,
      locationCity: profile.locationCity,
      remoteOnly: profile.remoteOnly,
      workAuth: profile.workAuth,
      salaryFloorUsd: profile.salaryFloorUsd,
      maxWeeklyHours: profile.maxWeeklyHours,
      englishCefr: profile.englishCefr,
      yearsTotal: profile.yearsTotal,
    },
    rules,
    job,
  });

  const result = await deps.llm.generateStructured(
    "evaluate_job",
    outputSchemaFor(promptVersion),
    vars,
    { userId: job.userId, jobId: job.id, promptVersion, signal: deps.signal },
  );
  if (!result.ok) {
    log.error(
      { kind: result.error.kind, detail: result.error.detail.slice(0, 300) },
      "evaluación falló",
    );
    return {
      ok: false,
      jobId,
      error: `${result.error.kind}: ${result.error.detail}`,
      retry: "retry",
    };
  }

  const evaluation = result.value.object;
  const decision = decide(evaluation, rules, {
    titleCap: titleCapFromFlags(job.flags),
    prefilterFlags: job.flags ?? [],
    candidateEnglishCefr: profile.englishCefr,
    candidateYearsTotal: profile.yearsTotal,
  });

  const [row] = await db
    .insert(s.evaluations)
    .values({
      jobId: job.id,
      userId: job.userId,
      criteriaVersion: criteria.version,
      promptVersion,
      model: result.value.model,
      hadFullJd: true,
      score: decision.scoreFinal,
      scoreModel: decision.scoreModel,
      yearsRequired: evaluation.years_required,
      yearsDomain: evaluation.years_domain,
      yearsDiscipline: evaluation.years_discipline,
      locationOk: evaluation.location_ok,
      modality: evaluation.modalidad,
      discipline: evaluation.disciplina,
      englishRequired: evaluation.ingles_requerido,
      companyType: evaluation.tipo_empresa,
      matchFuerte: evaluation.match_fuerte,
      gaps: evaluation.gaps.map((g) => `${g.skill} (${g.nivel})`),
      bloqueadoresDuros: decision.bloqueadores,
      riesgos: decision.riesgos,
      senalesPositivas: evaluation.senales_positivas,
      veredicto: evaluation.veredicto,
      accion: decision.accion,
      decision: { adjustments: decision.adjustments, accion_sugerida: evaluation.accion_sugerida },
      raw: evaluation,
      createdAt: deps.now?.() ?? new Date(),
    })
    .returning({ id: s.evaluations.id });

  const status = transition(job.status, "evaluated");
  await db
    .update(s.jobs)
    .set({ status, updatedAt: deps.now?.() ?? new Date() })
    .where(eq(s.jobs.id, job.id));

  log.info(
    {
      score: decision.scoreFinal,
      score_model: decision.scoreModel,
      accion: decision.accion,
      model: result.value.model,
      status,
    },
    "evaluado",
  );
  return {
    ok: true,
    jobId,
    evaluationId: row!.id,
    costUsd: result.value.costUsd,
    score: decision.scoreFinal,
    accion: decision.accion,
    status,
  };
}

export type WorkerSummary = {
  /** Gasto de las últimas 24 h al arrancar (USD) y tope aplicado (0 = sin tope). */
  spendUsd24h: number;
  dailyCapUsd: number;
  /** true si el worker se frenó por tope de gasto o por señal; lo no procesado sigue en la cola. */
  stopped: "cap" | "signal" | null;
  taken: number;
  evaluated: number;
  retried: number;
  failed: number;
  skipped: number;
  requeuedStale: number;
  outcomes: EvaluateOutcome[];
};

/** Procesa hasta `limit` mensajes de la cola evaluate_job (route /api/cron/evaluate y CLI). */
export async function runEvaluateWorker(
  deps: EvaluateDeps,
  options: {
    limit?: number;
    staleAfterSeconds?: number;
    /** Tope de gasto en 24 h móviles (USD). Default: LLM_DAILY_CAP_USD o DEFAULT_DAILY_CAP_USD; 0 = sin tope. */
    dailyCapUsd?: number;
  } = {},
): Promise<WorkerSummary> {
  const limit = options.limit ?? 20;
  const dailyCapUsd = options.dailyCapUsd ?? dailyCapFromEnv();
  const requeuedStale = await deps.queue.requeueStale(
    EVALUATE_QUEUE,
    options.staleAfterSeconds ?? 15 * 60,
  );

  // Guardarraíl de costo: se mira ANTES de tomar mensajes (nada queda en processing si ya se pasó)
  const spend = await spendLast24h(deps.db, deps.now);
  const overCap = () => dailyCapUsd > 0 && spend.usd >= dailyCapUsd;
  const base = {
    spendUsd24h: spend.usd,
    dailyCapUsd,
    requeuedStale,
    evaluated: 0,
    retried: 0,
    failed: 0,
    skipped: 0,
    outcomes: [] as EvaluateOutcome[],
  };
  if (spend.unpricedCalls > 0) {
    deps.logger.warn(
      { unpriced_calls: spend.unpricedCalls },
      "llm_calls con cost_usd null en 24 h: el tope no las ve (falta tarifa en model_routing)",
    );
  }
  if (overCap()) {
    deps.logger.error(
      { spend_usd_24h: spend.usd, cap_usd: dailyCapUsd },
      "worker frenado: gasto de 24 h supera LLM_DAILY_CAP_USD",
    );
    return { ...base, stopped: "cap", taken: 0 };
  }
  if (deps.signal?.aborted) return { ...base, stopped: "signal", taken: 0 };

  const messages = await deps.queue.dequeue<EvaluatePayload>(EVALUATE_QUEUE, limit);
  const summary: WorkerSummary = {
    ...base,
    stopped: null,
    taken: messages.length,
    evaluated: 0,
    retried: 0,
    failed: 0,
    skipped: 0,
    requeuedStale,
  };
  // Devolver a pending sin gastar un intento: el mensaje no se procesó
  const requeue = (id: string, why: string) => deps.queue.release(id, why);
  for (const [i, msg] of messages.entries()) {
    if (deps.signal?.aborted || overCap()) {
      summary.stopped = deps.signal?.aborted ? "signal" : "cap";
      for (const rest of messages.slice(i))
        await requeue(rest.id, `worker frenado: ${summary.stopped}`);
      summary.taken = i;
      break;
    }
    let outcome: EvaluateOutcome;
    try {
      outcome = await evaluateJobById(msg.payload.jobId, deps);
    } catch (e) {
      outcome = {
        ok: false,
        jobId: msg.payload.jobId,
        error: e instanceof Error ? e.message : String(e),
        retry: "retry",
      };
    }
    if (!outcome.ok && outcome.error.startsWith("aborted:")) {
      // Cancelada por señal: vuelve a pending sin contar intento y se corta el loop
      await requeue(msg.id, outcome.error);
      for (const rest of messages.slice(i + 1)) await requeue(rest.id, "worker frenado: signal");
      summary.stopped = "signal";
      summary.taken = i;
      break;
    }
    summary.outcomes.push(outcome);
    if (outcome.ok) {
      await deps.queue.ack(msg.id);
      summary.evaluated++;
      // El costo de esta llamada entra al acumulado sin volver a consultar la base
      spend.usd += outcome.costUsd ?? 0;
    } else if (outcome.retry === "skipped") {
      await deps.queue.ack(msg.id);
      summary.skipped++;
    } else if (outcome.retry === "failed") {
      // Job inexistente o sin perfil: no hay reintento que lo arregle, se descarta ya
      await deps.queue.fail(msg.id, outcome.error, { final: true });
      summary.failed++;
    } else {
      const r = await deps.queue.fail(msg.id, outcome.error);
      if (r === "retry") summary.retried++;
      else summary.failed++;
    }
  }
  return summary;
}

export type EvaluateNowResult =
  { ran: true; outcome: EvaluateOutcome } | { ran: false; reason: "cap" | "not_pending" };

/**
 * Evaluación inmediata de un job recién encolado (JS-027: pegar JD evalúa al instante, sin
 * esperar al cron). Mismos guardarraíles que el worker: tope de gasto de 24 h antes de tocar la
 * cola, reclamo del mensaje con SKIP LOCKED (si el cron ya lo tiene, no evalúa dos veces) y el
 * mismo cierre del mensaje: ok/skipped → done, falla → reintento con backoff para el cron.
 */
export async function evaluateJobNow(
  jobId: string,
  deps: EvaluateDeps,
  options: { dailyCapUsd?: number } = {},
): Promise<EvaluateNowResult> {
  const log = deps.logger.child({ job_id: jobId });
  const dailyCapUsd = options.dailyCapUsd ?? dailyCapFromEnv();
  if (dailyCapUsd > 0) {
    const spend = await spendLast24h(deps.db, deps.now);
    if (spend.usd >= dailyCapUsd) {
      log.warn(
        { spend_usd_24h: spend.usd, cap_usd: dailyCapUsd },
        "evaluación inmediata frenada por el tope de gasto: queda para el cron",
      );
      return { ran: false, reason: "cap" };
    }
  }
  const msg = await deps.queue.claimForJob<EvaluatePayload>(EVALUATE_QUEUE, jobId);
  if (!msg) return { ran: false, reason: "not_pending" };

  let outcome: EvaluateOutcome;
  try {
    outcome = await evaluateJobById(jobId, deps);
  } catch (e) {
    outcome = {
      ok: false,
      jobId,
      error: e instanceof Error ? e.message : String(e),
      retry: "retry",
    };
  }
  if (outcome.ok || outcome.retry === "skipped") await deps.queue.ack(msg.id);
  else if (!outcome.ok && outcome.error.startsWith("aborted:"))
    await deps.queue.release(msg.id, outcome.error);
  else if (outcome.retry === "failed")
    await deps.queue.fail(msg.id, outcome.error, { final: true });
  else await deps.queue.fail(msg.id, outcome.error);
  log.info(
    { ok: outcome.ok, ...(outcome.ok ? { score: outcome.score } : { error: outcome.error }) },
    "evaluación inmediata",
  );
  return { ran: true, outcome };
}
