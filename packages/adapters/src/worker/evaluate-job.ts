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
import { dailyCapFromEnv, spendLast24h, userDailyCapUsd } from "../llm/spend";
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
  /** Mensajes devueltos a pending porque su dueño pasó el tope diario por usuario (JS-093). */
  userCapped: number;
  requeuedStale: number;
  outcomes: EvaluateOutcome[];
};

export { spendCapReason } from "../llm/spend";

/** Mensaje para la UI cuando el tope por usuario frena una evaluación. */
export const USER_CAP_MESSAGE = "tope diario de evaluaciones alcanzado";

/** Cuánto se pospone un mensaje de un usuario topeado (la ventana de 24 h es móvil: 1 h alcanza). */
const USER_CAP_DEFER_MS = 60 * 60 * 1000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function jobOwner(db: Db, jobId: string): Promise<string | null> {
  // Un payload con un id que no es uuid (mensaje corrupto) no tiene dueño: evaluateJobById lo descarta
  if (!UUID_RE.test(jobId)) return null;
  const [row] = await db
    .select({ userId: s.jobs.userId })
    .from(s.jobs)
    .where(eq(s.jobs.id, jobId))
    .limit(1);
  return row?.userId ?? null;
}

/**
 * Gasto de 24 h por usuario (filtra explícito por user_id: el worker usa rol de servicio, sin RLS)
 * con caché dentro de una corrida: se consulta una vez por usuario y
 * después se suma el costo de lo que el worker evalúa, sin volver a la base por cada mensaje.
 * Exceso máximo posible: el chequeo es previo a cada llamada, así que un usuario puede pasarse
 * del tope por lo que cueste UNA evaluación por worker concurrente (cron + pegar JD + CLI corren
 * cada uno con su caché y no ven las llamadas en vuelo de los otros): como mucho
 * (workers concurrentes) × (costo de una evaluación) por encima del tope.
 */
function userSpendTracker(deps: EvaluateDeps, capUsd: number) {
  const spent = new Map<string, number>();
  return {
    async isOver(userId: string | null): Promise<boolean> {
      if (capUsd <= 0 || !userId) return false;
      let usd = spent.get(userId);
      if (usd === undefined) {
        usd = (await spendLast24h(deps.db, deps.now, { userId })).usd;
        spent.set(userId, usd);
      }
      return usd >= capUsd;
    },
    add(userId: string | null, usd: number): void {
      if (userId && spent.has(userId)) spent.set(userId, spent.get(userId)! + usd);
    },
  };
}

/** Procesa hasta `limit` mensajes de la cola evaluate_job (route /api/cron/evaluate y CLI). */
export async function runEvaluateWorker(
  deps: EvaluateDeps,
  options: {
    limit?: number;
    staleAfterSeconds?: number;
    /** Tope de gasto en 24 h móviles (USD). Default: LLM_DAILY_CAP_USD o DEFAULT_DAILY_CAP_USD; 0 = sin tope. */
    dailyCapUsd?: number;
    /** Tope por usuario en 24 h (USD). Default: LLM_USER_DAILY_CAP_USD o 1; 0 = sin tope. */
    userDailyCapUsd?: number;
  } = {},
): Promise<WorkerSummary> {
  const limit = options.limit ?? 20;
  const dailyCapUsd = options.dailyCapUsd ?? dailyCapFromEnv();
  const userCapUsd = options.userDailyCapUsd ?? userDailyCapUsd();
  if (userCapUsd === 0) {
    deps.logger.info(
      "tope por usuario desactivado (LLM_USER_DAILY_CAP_USD=0): solo rige el global",
    );
  }
  const userCap = userSpendTracker(deps, userCapUsd);
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
    userCapped: 0,
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

  const summary: WorkerSummary = {
    ...base,
    stopped: null,
    taken: 0,
    evaluated: 0,
    retried: 0,
    failed: 0,
    skipped: 0,
    requeuedStale,
  };
  // Devolver a pending sin gastar un intento: el mensaje no se procesó
  const requeue = (id: string, why: string) => deps.queue.release(id, why);
  const nowMs = () => (deps.now?.() ?? new Date()).getTime();
  // Un usuario topeado se pospone: sus mensajes no vuelven a ocupar el lote hasta dentro de 1 h
  const deferredUsers = new Set<string>();
  batches: for (;;) {
    const messages = await deps.queue.dequeue<EvaluatePayload>(EVALUATE_QUEUE, limit);
    if (messages.length === 0) break;
    const takenBefore = summary.taken;
    summary.taken += messages.length;
    let deferredInBatch = 0;
    for (const [i, msg] of messages.entries()) {
      if (deps.signal?.aborted || overCap()) {
        summary.stopped = deps.signal?.aborted ? "signal" : "cap";
        for (const rest of messages.slice(i))
          await requeue(rest.id, `worker frenado: ${summary.stopped}`);
        summary.taken = takenBefore + i;
        break batches;
      }
      // Tope por usuario: su mensaje vuelve a pending y el worker sigue con los de otros usuarios.
      // El dueño sale de jobs.user_id, no de job_queue.user_id (nullable).
      const ownerId = await jobOwner(deps.db, msg.payload.jobId);
      if (await userCap.isOver(ownerId)) {
        const until = new Date(nowMs() + USER_CAP_DEFER_MS);
        await deps.queue.release(msg.id, USER_CAP_MESSAGE, { runAfter: until });
        if (ownerId && !deferredUsers.has(ownerId)) {
          deferredUsers.add(ownerId);
          deps.logger.warn(
            { user_id: ownerId, job_id: msg.payload.jobId },
            "evaluaciones diferidas: el usuario pasó su tope diario (LLM_USER_DAILY_CAP_USD)",
          );
          // El resto de sus pendientes también, para que no llenen el próximo lote
          await deps.db
            .update(s.jobQueue)
            .set({ runAfter: until })
            .where(
              and(
                eq(s.jobQueue.queue, EVALUATE_QUEUE),
                eq(s.jobQueue.status, "pending"),
                eq(s.jobQueue.userId, ownerId),
              ),
            );
        }
        summary.userCapped++;
        deferredInBatch++;
        continue;
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
        summary.taken = takenBefore + i;
        break batches;
      }
      summary.outcomes.push(outcome);
      if (outcome.ok) {
        await deps.queue.ack(msg.id);
        summary.evaluated++;
        // El costo de esta llamada entra al acumulado sin volver a consultar la base
        spend.usd += outcome.costUsd ?? 0;
        userCap.add(ownerId, outcome.costUsd ?? 0);
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
    // Lote entero diferido por tope: hay que traer otro, o los de otros usuarios no se evalúan nunca
    if (deferredInBatch < messages.length) break;
  }
  return summary;
}

export type EvaluateNowResult =
  | { ran: true; outcome: EvaluateOutcome }
  | { ran: false; reason: "cap" | "not_pending" }
  /** El dueño pasó su tope diario por usuario (JS-093): `message` es apto para mostrar en la UI. */
  | { ran: false; reason: "user_cap"; message: string };

/**
 * Evaluación inmediata de un job recién encolado (JS-027: pegar JD evalúa al instante, sin
 * esperar al cron). Mismos guardarraíles que el worker: tope de gasto de 24 h antes de tocar la
 * cola, reclamo del mensaje con SKIP LOCKED (si el cron ya lo tiene, no evalúa dos veces) y el
 * mismo cierre del mensaje: ok/skipped → done, falla → reintento con backoff para el cron.
 */
export async function evaluateJobNow(
  jobId: string,
  deps: EvaluateDeps,
  options: { dailyCapUsd?: number; userDailyCapUsd?: number } = {},
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
  // Tope por usuario: el mensaje queda pending (nadie lo reclamó) para cuando se libere la ventana
  const userCapUsd = options.userDailyCapUsd ?? userDailyCapUsd();
  if (userCapUsd > 0) {
    const [owner] = await deps.db
      .select({ userId: s.jobs.userId })
      .from(s.jobs)
      .where(eq(s.jobs.id, jobId))
      .limit(1);
    if (owner && (await userSpendTracker(deps, userCapUsd).isOver(owner.userId))) {
      log.warn(
        { user_id: owner.userId, cap_usd: userCapUsd },
        "evaluación inmediata frenada por el tope diario del usuario: queda para el cron",
      );
      return { ran: false, reason: "user_cap", message: USER_CAP_MESSAGE };
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
