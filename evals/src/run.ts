import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  averageTokensFor,
  createLlmClient,
  createLogger,
  createProviderRegistry,
  dailyCapFromEnv,
  drizzleCallSink,
  memoryCallSink,
  parseThinkingLevel,
  spendLast24h,
  THINKING_LEVELS,
  providerForModel,
  staticRouteSource,
  type CallSink,
  type GenerateFn,
  type LlmClient,
  type RouteConfig,
  type ThinkingLevel,
} from "@job-search-os/adapters";
import { createDb, requireDatabaseUrl, type DbTarget } from "@job-search-os/db";
import { decide, outputSchemaFor, type Adjustment, type Evaluation } from "@job-search-os/pipeline";
import type { PromptRef } from "@job-search-os/prompts";
import routingSeed from "../../packages/db/seeds/model_routing.json";
import {
  criteriaRules,
  goldenJobs,
  goldenMeta,
  goldenPrefilter,
  goldenVars,
  type GoldenJob,
} from "./golden";
import {
  anchorBlockers,
  anchorFor,
  anchorLocation,
  checkThresholds,
  computeMetrics,
  isUnstable,
  median,
  type Anchor,
  type JobRow,
  type Metrics,
} from "./metrics";

/**
 * Jobs ancla: definen las fronteras (ML vs AI engineer, Lead con excepción, riesgo de
 * ubicación, .NET periférico vs central, match alto sin stack pesado). Con --subset --runs 1
 * son 14 llamadas en vez de 102: para iterar una hipótesis, no para validar.
 */
export const ANCHOR_IDS = [1, 6, 7, 11, 12, 13, 14, 16, 24, 28, 30, 32, 33, 34];

/** Tope de llamadas por corrida salvo --force. Las corridas completas quedan para la validación final. */
export const DEFAULT_CALL_BUDGET = 150;

export class RunAbortedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunAbortedError";
  }
}

/**
 * Tokens por llamada de evaluate_job para estimar el costo ANTES de correr. Orden de fuentes:
 * 1. historia en `llm_calls` (últimas 50 llamadas ok del modelo, separadas por si gastaron
 *    thinking; mínimo 5), 2. promedio medido por modelo y nivel de thinking (tabla abajo),
 * 3. supuesto conservador (el caso caro del 2026-09-10: thinking dinámico ~85% de la salida).
 * El costo se factura por lo real; esto solo decide si se pide confirmación.
 */
export const ESTIMATED_TOKENS_PER_CALL = { in: 1_800, out: 2_100 };

export type TokenSample = { in: number; out: number; source: string };

/** Promedios medidos en llm_calls (Neon). Clave: `<modelo>:<thinking|default>`. */
export const MEASURED_TOKENS_PER_CALL: Record<string, Omit<TokenSample, "source">> = {
  // 2026-09-11, evaluate_job v1.1/v1.2 subsets (14 llamadas) y job 33: 0 tokens de thinking
  "gemini-3.5-flash:minimal": { in: 1_950, out: 430 },
  "gemini-3.1-flash-lite:minimal": { in: 1_950, out: 400 },
  // 2026-09-10, sin thinking_level (dinámico): ~85% de la salida fue thinking
  "gemini-3.5-flash:default": { in: 1_760, out: 2_050 },
};

/** Muestra estática para (modelo, thinking): medida si existe, si no el supuesto conservador. */
export function tokenSampleFor(model: string, thinking: ThinkingLevel | null): TokenSample {
  const key = `${model}:${thinking ?? "default"}`;
  const measured = MEASURED_TOKENS_PER_CALL[key];
  if (measured) return { ...measured, source: `promedio medido para ${key}` };
  return {
    ...ESTIMATED_TOKENS_PER_CALL,
    source: "supuesto conservador (sin medición para este modelo/thinking)",
  };
}

export type CostEstimate = {
  calls: number;
  tokensInPerCall: number;
  tokensOutPerCall: number;
  /** De dónde salieron los tokens por llamada (historia, medición o supuesto). */
  source: string;
  /** null si model_routing no tiene tarifa para el modelo elegido. */
  usd: number | null;
};

export class BudgetExceededError extends Error {
  constructor(calls: number, budget: number) {
    super(
      `la corrida haría ${calls} llamadas y el presupuesto es ${budget}. Usá --subset, bajá --runs, o confirmá con --force.`,
    );
    this.name = "BudgetExceededError";
  }
}

export type RunOptions = {
  prompt: PromptRef;
  model?: string;
  runs: number;
  concurrency: number;
  ids?: number[];
  /** Solo los jobs ancla (ANCHOR_IDS). Se combina con ids si vienen ambos (intersección). */
  subset?: boolean;
  /** Tope de llamadas (jobs × corridas). Default DEFAULT_CALL_BUDGET. */
  budget?: number;
  /** Permite exceder el presupuesto. */
  force?: boolean;
  outDir?: string;
  /** Sufijo del archivo de reporte (ej. "paso1-fixture") y llm_calls.label. */
  label?: string;
  /** Override de model_routing.thinking_level (none | minimal | low | medium | high). */
  thinking?: ThinkingLevel;
  /**
   * Dónde persistir llm_calls (task `eval:<versión>`): "cloud" (DATABASE_URL), "local" (Docker) o
   * "none" (solo memoria, para tests). Default: cloud si hay DATABASE_URL, si no none con aviso.
   */
  db?: DbTarget | "none";
  /** Reemplaza generateObject (hook de prueba del cleanup: LLM_FAKE_GENERATE=hang). */
  generate?: GenerateFn;
  /** Cancela la corrida (SIGINT/SIGTERM, tope de minutos): aborta llamadas en curso y no arranca nuevas. */
  signal?: AbortSignal;
  /** Inyectable en tests. */
  client?: LlmClient;
  sleep?: (ms: number) => Promise<void>;
};

export type JobReport = JobRow & {
  empresa: string;
  titulo: string;
  ubicacion_raw: string;
  /** model_score − ancla (human_score en v1, human_score_match en v1.1+). */
  delta: number | null;
  veredicto: string | null;
  confianza: string | null;
  model_action_suggested: string | null;
  model_gaps: { skill: string; nivel: string }[];
  /** Salida cruda del modelo (la evaluación representativa), para recalcular métricas sin llamar a la API. */
  model_raw: Evaluation | null;
  /** Lo que decide() de producción hizo con esa salida: prefiltro, cap, penalizaciones, riesgos agregados. */
  decision: HarnessDecision | null;
  errors: string[];
};

export type HarnessDecision = {
  prefilter:
    | { pass: true; cap: number | null; flags: string[] }
    | { pass: false; reason: string; detail: string };
  score_final: number | null;
  bloqueadores: string[];
  riesgos: string[];
  adjustments: Adjustment[];
};

/**
 * Acción como la calcularía producción: prefiltro (descarte o cap + flags) y decide() completo
 * sobre la salida cruda del modelo. Las métricas del MODELO (bloqueadores, riesgos, ubicación,
 * score) siguen mirando la salida cruda; solo la acción pasa por acá.
 */
export function productionDecision(
  job: GoldenJob,
  rep: Evaluation | null,
  modelScore: number | null,
): { action: string | null; decision: HarnessDecision | null } {
  if (!rep || modelScore === null) return { action: null, decision: null };
  const pre = goldenPrefilter(job);
  if (!pre.pass) {
    return {
      action: "descartar",
      decision: {
        prefilter: pre,
        score_final: null,
        bloqueadores: [`prefiltro: ${pre.reason}`],
        riesgos: [],
        adjustments: [],
      },
    };
  }
  const d = decide({ ...rep, score: modelScore }, criteriaRules, {
    titleCap: pre.cap,
    prefilterFlags: pre.flags,
  });
  return {
    action: d.accion,
    decision: {
      prefilter: pre,
      score_final: d.scoreFinal,
      bloqueadores: d.bloqueadores,
      riesgos: d.riesgos,
      adjustments: d.adjustments,
    },
  };
}

/** Un bloqueador humano que el modelo no reportó como bloqueador: qué devolvió en su lugar. */
export type MissedBlocker = {
  id: number;
  empresa: string;
  bloqueador_humano: string[];
  modelo_bloqueadores: string[];
  modelo_riesgos: string[];
  modelo_score: number | null;
  modelo_accion: string | null;
  veredicto: string | null;
};

/** El modelo devolvió un bloqueador donde el humano no tenía ninguno (v1.1: un riesgo mal ubicado). */
export type FalseBlocker = {
  id: number;
  empresa: string;
  modelo_bloqueadores: string[];
  riesgo_humano: string[];
  modelo_score: number | null;
  modelo_accion: string | null;
};

export type MissedRisk = {
  id: number;
  empresa: string;
  riesgo_humano: string[];
  modelo_riesgos: string[];
  modelo_bloqueadores: string[];
  modelo_location_ok: string | null;
};

export type LocationMismatch = {
  id: number;
  empresa: string;
  ubicacion_raw: string;
  humano: string;
  modelo: string | null;
  modelo_score: number | null;
};

export type Report = {
  meta: {
    prompt: string;
    model: string;
    provider: string;
    label: string | null;
    thinking: ThinkingLevel | null;
    /** Dónde quedaron registradas las llamadas (llm_calls) o "none". */
    db: string;
    subset: boolean;
    anchor: Anchor;
    runs: number;
    date: string;
    golden_version: string;
    /** Presente si las métricas se recalcularon con pnpm evals recompute. */
    recomputed?: string;
    calls: number;
    calls_failed: number;
    tokens_in: number;
    tokens_out: number;
    /** Parte de tokens_out que fue thinking (0 si el proveedor no lo informa). */
    tokens_reasoning: number;
    cost_usd: number | null;
    duration_ms: number;
  };
  metrics: Metrics;
  thresholds: ReturnType<typeof checkThresholds>;
  diagnostics: {
    missed_blockers: MissedBlocker[];
    false_blockers: FalseBlocker[];
    missed_risks: MissedRisk[];
    location_mismatches: LocationMismatch[];
  };
  jobs: JobReport[];
};

const REPORTS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../reports");
const RETRY_DELAYS_MS = [5_000, 20_000, 60_000];

/**
 * Errores que no se arreglan reintentando: cortan la corrida entera con el mensaje a la vista.
 * Ojo con el nivel gratuito: Google responde 429 con "check your plan and billing details" tanto
 * para la cuota POR MINUTO (transitoria: se espera y se reintenta) como para la POR DÍA (fatal:
 * no hay más llamadas hasta medianoche Pacífico). Se distinguen por el nombre de la cuota.
 * "no cumple el schema" es fatal a propósito: con temperature 0 la salida es la misma en cada
 * reintento y cada reintento se factura igual (el 2026-09-10 un loop así costó ~USD 6).
 */
const PER_MINUTE_QUOTA = /PerMinute|per minute|requests per minute/i;
const FATAL_ERROR =
  /credits are depleted|PerDay|per day|daily|billing (account|is not|not enabled|disabled)|API key not valid|API_KEY_INVALID|PERMISSION_DENIED|salida no cumple el schema/i;

/** Clasificación de un error del proveedor para el loop de reintentos. */
export function classifyError(detail: string): "fatal" | "rate_limit" | "retry" {
  if (PER_MINUTE_QUOTA.test(detail)) return "rate_limit";
  return FATAL_ERROR.test(detail) ? "fatal" : "retry";
}
/** Ante cuota por minuto se espera al menos esto antes de volver a intentar. */
const RATE_LIMIT_WAIT_MS = 65_000;

export class FatalEvalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FatalEvalError";
  }
}

/** Tarifa de un modelo según cualquier fila del seed donde aparezca (primario o fallback). */
export function priceForModel(model: string): { input: number | null; output: number | null } {
  for (const r of routingSeed) {
    if (r.model === model && r.input_usd_per_mtok !== null) {
      return { input: r.input_usd_per_mtok, output: r.output_usd_per_mtok };
    }
    if (r.fallback_model === model && r.fallback_input_usd_per_mtok !== null) {
      return { input: r.fallback_input_usd_per_mtok, output: r.fallback_output_usd_per_mtok };
    }
  }
  return { input: null, output: null };
}

/** Ruta para evals: fila de evaluate_job del seed, con `--model` / `--thinking` como override y SIN fallback. */
export function routeFor(model?: string, thinking?: ThinkingLevel): RouteConfig {
  const base = routingSeed.find((r) => r.task === "evaluate_job");
  if (!base) throw new Error("seeds/model_routing.json no tiene evaluate_job");
  const chosen = model ?? base.model;
  const price = priceForModel(chosen);
  return {
    task: "evaluate_job",
    provider: providerForModel(chosen, base.provider),
    model: chosen,
    fallbackModel: null,
    temperature: base.temperature,
    maxTokens: base.max_tokens,
    thinkingLevel: thinking ?? parseThinkingLevel(base.thinking_level),
    inputUsdPerMtok: price.input,
    outputUsdPerMtok: price.output,
    fallbackInputUsdPerMtok: null,
    fallbackOutputUsdPerMtok: null,
  };
}

export function parseThinkingFlag(raw: string | undefined): ThinkingLevel | undefined {
  if (raw === undefined) return undefined;
  const level = parseThinkingLevel(raw);
  if (!level) throw new Error(`--thinking inválido: '${raw}' (${THINKING_LEVELS.join(" | ")})`);
  return level;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Jobs que correría una corrida con estas opciones (misma regla que runEvals). */
function selectJobs(options: Pick<RunOptions, "ids" | "subset">): GoldenJob[] {
  const wanted = new Set(
    options.subset
      ? ANCHOR_IDS.filter((id) => !options.ids?.length || options.ids.includes(id))
      : (options.ids ?? []),
  );
  return wanted.size ? goldenJobs.filter((j) => wanted.has(j.id)) : goldenJobs;
}

/** Costo estimado antes de la primera llamada: llamadas × tokens por llamada × tarifa de model_routing. */
export function estimateRunCost(
  options: Pick<RunOptions, "ids" | "subset" | "runs" | "model" | "thinking">,
  sample?: TokenSample,
): CostEstimate {
  const route = routeFor(options.model, options.thinking);
  const tokens = sample ?? tokenSampleFor(route.model, route.thinkingLevel);
  const calls = selectJobs(options).length * options.runs;
  const usd =
    route.inputUsdPerMtok === null || route.outputUsdPerMtok === null
      ? null
      : (calls * (tokens.in * route.inputUsdPerMtok + tokens.out * route.outputUsdPerMtok)) /
        1_000_000;
  return {
    calls,
    tokensInPerCall: tokens.in,
    tokensOutPerCall: tokens.out,
    source: tokens.source,
    usd,
  };
}

/** Dónde persistir llm_calls (misma regla para el estimador y la corrida). */
function resolveDbMode(options: Pick<RunOptions, "db" | "client">): DbTarget | "none" {
  if (options.client) return "none";
  return options.db ?? (process.env.DATABASE_URL ? "cloud" : "none");
}

/**
 * Estimación con historia: si llm_calls tiene ≥ 5 llamadas ok del modelo en la misma
 * partición de thinking (con o sin tokens de razonamiento), usa ese promedio; si no, la tabla
 * medida o el supuesto conservador. Sin base (db none) cae a estimateRunCost.
 */
export async function estimateRunCostWithHistory(
  options: Pick<RunOptions, "ids" | "subset" | "runs" | "model" | "thinking" | "db" | "client">,
): Promise<CostEstimate> {
  const dbMode = resolveDbMode(options);
  if (dbMode === "none") return estimateRunCost(options);
  const route = routeFor(options.model, options.thinking);
  const conn = createDb(requireDatabaseUrl({ purpose: "service", target: dbMode }), { max: 1 });
  try {
    const withReasoning =
      route.thinkingLevel !== null &&
      route.thinkingLevel !== "minimal" &&
      route.thinkingLevel !== "none";
    const avg = await averageTokensFor(conn.db, {
      model: route.model,
      withReasoning,
      taskPrefix: "eval",
    });
    if (!avg) return estimateRunCost(options);
    return estimateRunCost(options, {
      in: avg.tokensIn,
      out: avg.tokensOut,
      source: `promedio de las últimas ${avg.calls} llamadas de evals en llm_calls (${dbMode}, ${withReasoning ? "con" : "sin"} thinking)`,
    });
  } finally {
    await conn.close();
  }
}

async function evaluateOnce(
  client: LlmClient,
  job: GoldenJob,
  prompt: PromptRef,
  sleep: (ms: number) => Promise<void>,
  signal?: AbortSignal,
  ctx: { recordTask?: string; label?: string } = {},
): Promise<{ ok: true; value: Evaluation } | { ok: false; error: string }> {
  const schema = outputSchemaFor(prompt);
  let lastError = "";
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (signal?.aborted) throw new RunAbortedError(abortReason(signal));
    const r = await client.generateStructured("evaluate_job", schema, goldenVars(job), {
      promptVersion: prompt,
      signal,
      ...ctx,
    });
    if (r.ok) return { ok: true, value: r.value.object };
    if (r.error.kind === "aborted" && signal?.aborted)
      throw new RunAbortedError(abortReason(signal));
    lastError = `${r.error.kind}: ${r.error.detail}`;
    const kind = classifyError(r.error.detail);
    if (kind === "fatal") {
      throw new FatalEvalError(`corrida abortada (job ${job.id}): ${r.error.detail.slice(0, 300)}`);
    }
    if (r.error.kind !== "generation_failed") break; // prompt / ruta / proveedor: reintentar no ayuda
    if (attempt < RETRY_DELAYS_MS.length) {
      const wait =
        kind === "rate_limit"
          ? Math.max(RATE_LIMIT_WAIT_MS, RETRY_DELAYS_MS[attempt]!)
          : RETRY_DELAYS_MS[attempt]!;
      if (kind === "rate_limit")
        process.stderr.write(`  cuota por minuto (job ${job.id}): espero ${wait / 1000} s
`);
      await sleep(wait);
    }
  }
  return { ok: false, error: lastError };
}

const abortReason = (signal: AbortSignal): string => {
  const r: unknown = signal.reason;
  return r instanceof Error ? r.message : String(r ?? "cancelada");
};

/** Elige, entre las corridas, la que tiene el score mediano (para los campos categóricos). */
function representative(evals: Evaluation[]): Evaluation {
  const sorted = [...evals].sort((a, b) => a.score - b.score);
  return sorted[Math.floor((sorted.length - 1) / 2)]!;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function runEvals(options: RunOptions): Promise<Report> {
  const startedAt = Date.now();
  const route = routeFor(options.model, options.thinking);
  const anchor = anchorFor(options.prompt);
  const version = options.prompt.split("@")[1] ?? "v1";
  const calls = memoryCallSink();
  const sleep = options.sleep ?? defaultSleep;

  // Persistencia en llm_calls (task eval:<versión>, label): sin esto el gasto de evals es invisible
  const dbMode = resolveDbMode(options);
  let conn: ReturnType<typeof createDb> | null = null;
  let dbLabel = "none";
  let sink: CallSink = calls;
  if (dbMode !== "none") {
    const url = requireDatabaseUrl({ purpose: "service", target: dbMode });
    conn = createDb(url, { max: 2 });
    dbLabel = dbMode;
    const persistent = drizzleCallSink(conn.db);
    sink = {
      async record(call) {
        await calls.record(call);
        await persistent.record(call);
      },
    };
    // Mismo tope que el worker: las 24 h móviles incluyen evals y operación
    const cap = dailyCapFromEnv();
    const spend = await spendLast24h(conn.db);
    if (cap > 0 && spend.usd >= cap) {
      await conn.close();
      throw new FatalEvalError(
        `gasto de 24 h USD ${spend.usd.toFixed(3)} ≥ LLM_DAILY_CAP_USD=${cap}: no se corre (pnpm llm:spend)`,
      );
    }
    process.stderr.write(
      `llm_calls: ${dbMode} (gasto 24 h USD ${spend.usd.toFixed(3)} / tope ${cap})\n`,
    );
  } else if (!options.client) {
    process.stderr.write(
      "llm_calls: none (sin DATABASE_URL, el gasto de esta corrida no queda registrado)\n",
    );
  }

  const client =
    options.client ??
    createLlmClient({
      routes: staticRouteSource([route]),
      calls: sink,
      providers: createProviderRegistry(),
      logger: createLogger({ run_id: `evals-${startedAt}` }),
      generate: options.generate,
    });
  const ctx = { recordTask: `eval:${version}`, label: options.label };
  try {
    return await runEvalsWith(options, {
      route,
      anchor,
      version,
      calls,
      sleep,
      client,
      ctx,
      dbLabel,
      startedAt,
    });
  } finally {
    await conn?.close();
  }
}

type RunEnv = {
  route: RouteConfig;
  anchor: Anchor;
  version: string;
  calls: ReturnType<typeof memoryCallSink>;
  sleep: (ms: number) => Promise<void>;
  client: LlmClient;
  ctx: { recordTask: string; label: string | undefined };
  dbLabel: string;
  startedAt: number;
};

async function runEvalsWith(options: RunOptions, env: RunEnv): Promise<Report> {
  const { route, anchor, version, calls, sleep, client, ctx, dbLabel, startedAt } = env;

  const jobs = selectJobs(options);
  const plannedCalls = jobs.length * options.runs;
  const budget = options.budget ?? DEFAULT_CALL_BUDGET;
  if (plannedCalls > budget && !options.force) throw new BudgetExceededError(plannedCalls, budget);
  process.stderr.write(
    `plan: ${jobs.length} jobs × ${options.runs} corrida(s) = ${plannedCalls} llamadas (presupuesto ${budget}${options.force ? ", --force" : ""})\n`,
  );

  // Unidad de trabajo: (job, corrida). Así la concurrencia reparte también las repeticiones.
  const units = jobs.flatMap((job) =>
    Array.from({ length: options.runs }, (_, run) => ({ job, run })),
  );
  let done = 0;
  const results = await mapWithConcurrency(units, options.concurrency, async ({ job }) => {
    const r = await evaluateOnce(client, job, options.prompt, sleep, options.signal, ctx);
    done++;
    if (done % 10 === 0 || done === units.length) {
      process.stderr.write(`  ${done}/${units.length} llamadas\n`);
    }
    return { jobId: job.id, r };
  });

  const jobReports: JobReport[] = jobs.map((job) => {
    const own = results.filter((x) => x.jobId === job.id).map((x) => x.r);
    const evals = own.flatMap((r) => (r.ok ? [r.value] : []));
    const errors = own.flatMap((r) => (r.ok ? [] : [r.error]));
    const scores = evals.map((e) => e.score);
    const rep = evals.length ? representative(evals) : null;
    const modelScore = median(scores);
    const { action: modelAction, decision } = productionDecision(job, rep, modelScore);
    const humanAnchor = anchor === "human_score" ? job.human_score : job.human_score_match;
    return {
      id: job.id,
      empresa: job.empresa,
      titulo: job.titulo,
      ubicacion_raw: job.ubicacion_raw,
      human_score: job.human_score,
      human_score_match: job.human_score_match,
      human_blockers: job.human_blockers,
      human_blockers_legacy: job.bloqueadores,
      human_risks: job.human_risks,
      human_discipline: job.disciplina,
      human_action: job.accion,
      human_location_ok: job.location_ok,
      human_location_ok_clean: job.human_location_ok,
      model_score: modelScore,
      scores,
      delta: modelScore !== null && humanAnchor !== null ? modelScore - humanAnchor : null,
      model_blockers: rep?.bloqueadores_duros ?? [],
      model_risks: rep?.riesgos ?? [],
      model_gaps: rep?.gaps ?? [],
      model_discipline: rep?.disciplina ?? null,
      model_action: modelAction,
      model_action_suggested: rep?.accion_sugerida ?? null,
      model_raw: rep,
      decision,
      model_location_ok: rep?.location_ok ?? null,
      unstable: isUnstable(scores),
      veredicto: rep?.veredicto ?? null,
      confianza: rep?.confianza ?? null,
      errors,
    };
  });

  const metrics = computeMetrics(jobReports, anchor);
  const okJobs = jobReports.filter((j) => j.model_score !== null);
  const missedBlockers: MissedBlocker[] = okJobs
    .filter((j) => anchorBlockers(j, anchor).length > 0 && !j.model_blockers.length)
    .map((j) => ({
      id: j.id,
      empresa: j.empresa,
      bloqueador_humano: anchorBlockers(j, anchor),
      modelo_bloqueadores: j.model_blockers,
      modelo_riesgos: j.model_risks,
      modelo_score: j.model_score,
      modelo_accion: j.model_action,
      veredicto: j.veredicto,
    }));
  const falseBlockers: FalseBlocker[] = okJobs
    .filter((j) => j.model_blockers.length > 0 && anchorBlockers(j, anchor).length === 0)
    .map((j) => ({
      id: j.id,
      empresa: j.empresa,
      modelo_bloqueadores: j.model_blockers,
      riesgo_humano: j.human_risks,
      modelo_score: j.model_score,
      modelo_accion: j.model_action,
    }));
  const missedRisks: MissedRisk[] =
    anchor === "human_score"
      ? []
      : okJobs
          .filter((j) => j.human_risks.length > 0 && !j.model_risks.length)
          .map((j) => ({
            id: j.id,
            empresa: j.empresa,
            riesgo_humano: j.human_risks,
            modelo_riesgos: j.model_risks,
            modelo_bloqueadores: j.model_blockers,
            modelo_location_ok: j.model_location_ok,
          }));
  const locationMismatches: LocationMismatch[] = okJobs
    .filter((j) => j.model_location_ok !== anchorLocation(j, anchor))
    .map((j) => ({
      id: j.id,
      empresa: j.empresa,
      ubicacion_raw: j.ubicacion_raw,
      humano: anchorLocation(j, anchor),
      modelo: j.model_location_ok,
      modelo_score: j.model_score,
    }));

  const tokensIn = calls.calls.reduce((a, c) => a + (c.tokensIn ?? 0), 0);
  const tokensOut = calls.calls.reduce((a, c) => a + (c.tokensOut ?? 0), 0);
  const tokensReasoning = calls.calls.reduce((a, c) => a + (c.tokensReasoning ?? 0), 0);
  const costs = calls.calls.map((c) => c.costUsd).filter((c): c is number => c !== null);
  const report: Report = {
    meta: {
      prompt: options.prompt,
      model: route.model,
      provider: route.provider,
      label: options.label ?? null,
      thinking: route.thinkingLevel,
      db: dbLabel,
      subset: Boolean(options.subset),
      anchor,
      runs: options.runs,
      date: new Date(startedAt).toISOString(),
      golden_version: goldenMeta.version,
      calls: calls.calls.length,
      calls_failed: calls.calls.filter((c) => !c.ok).length,
      tokens_in: tokensIn,
      tokens_out: tokensOut,
      tokens_reasoning: tokensReasoning,
      cost_usd: costs.length ? costs.reduce((a, b) => a + b, 0) : null,
      duration_ms: Date.now() - startedAt,
    },
    metrics,
    thresholds: checkThresholds(metrics),
    diagnostics: {
      missed_blockers: missedBlockers,
      false_blockers: falseBlockers,
      missed_risks: missedRisks,
      location_mismatches: locationMismatches,
    },
    jobs: jobReports,
  };

  if (options.outDir !== "") {
    const dir = options.outDir ?? REPORTS_DIR;
    mkdirSync(dir, { recursive: true });
    const suffix =
      (options.subset ? "_subset" : "") +
      (route.thinkingLevel ? `_${route.thinkingLevel}` : "") +
      (options.label ? `_${options.label}` : "");
    const file = join(
      dir,
      `${report.meta.date.slice(0, 10)}_${route.model}_${version}${suffix}.json`,
    );
    writeFileSync(file, JSON.stringify(report, null, 2) + "\n");
    process.stderr.write(`reporte: ${file}\n`);
  }
  return report;
}

export function formatReport(report: Report): string {
  const m = report.metrics;
  const pct = (v: number | null) => (v === null ? "n/a" : `${(v * 100).toFixed(0)}%`);
  const num = (v: number | null) => (v === null ? "n/a" : v.toFixed(2));
  const anchorLabel = m.anchor === "human_score" ? "human_score (v1)" : "human_score_match (v1.1+)";
  const lines = [
    `== ${report.meta.prompt} × ${report.meta.model}${report.meta.thinking ? ` [thinking ${report.meta.thinking}]` : ""}${report.meta.label ? ` (${report.meta.label})` : ""} · ${report.meta.runs} corrida(s) · ${report.meta.calls} llamadas (${report.meta.calls_failed} fallidas) · ${report.meta.tokens_in} in / ${report.meta.tokens_out} out (${report.meta.tokens_reasoning} thinking) · USD ${report.meta.cost_usd === null ? "?" : report.meta.cost_usd.toFixed(3)} · ${(report.meta.duration_ms / 1000).toFixed(0)} s · ancla: ${anchorLabel}`,
    "",
    "| métrica | valor | umbral |",
    "|---|---|---|",
    `| score_mae (ancla) | ${num(m.score_mae)} (n=${m.n_scored}) | ≤ 1.0 |`,
    `| score_mae vs human_score / vs human_score_match | ${num(m.score_mae_legacy)} / ${num(m.score_mae_match)} | informativo |`,
    `| blockers_recall (por tipo) | ${pct(m.blockers_recall)} | 100% |`,
    `| blockers_precision (por tipo) | ${pct(m.blockers_precision)} | 100% |`,
    `| blockers_recall_any (vieja: algún bloqueador) | ${pct(m.blockers_recall_any)} | informativo |`,
    `| risks_recall (por tipo, sin salario) | ${pct(m.risks_recall)} | 100% (v1.1+) |`,
    `| risks_recall_any (vieja: algún riesgo) | ${pct(m.risks_recall_any)} | informativo |`,
    `| discipline_acc | ${pct(m.discipline_acc)} | ≥ 90% |`,
    `| action_acc | ${pct(m.action_acc)} | ≥ 85% |`,
    `| false_apply | ${m.false_apply} | 0 |`,
    `| location_risk_recall (valor exacto) | ${pct(m.location_risk_recall)} | 100% |`,
    `| location_risk_recall_any (vieja: riesgo ≡ no) | ${pct(m.location_risk_recall_any)} | informativo |`,
    `| unstable | ${pct(m.unstable_ratio)} | ≤ 10% |`,
    "",
    "Top 5 deltas |modelo − ancla|:",
    "| id | empresa | ancla | modelo | delta | corridas | acción humana → modelo | veredicto |",
    "|---|---|---|---|---|---|---|---|",
  ];
  const top = report.jobs
    .filter((j) => j.delta !== null)
    .sort((a, b) => Math.abs(b.delta!) - Math.abs(a.delta!))
    .slice(0, 5);
  for (const j of top) {
    const anchorScore = m.anchor === "human_score" ? j.human_score : j.human_score_match;
    lines.push(
      `| ${j.id} | ${j.empresa} | ${anchorScore} | ${j.model_score} | ${j.delta! > 0 ? "+" : ""}${j.delta!.toFixed(1)} | ${j.scores.join("/")} | ${j.human_action} → ${j.model_action} | ${j.veredicto ?? ""} |`,
    );
  }

  const d = report.diagnostics;
  lines.push("", `Bloqueadores humanos no detectados (${d.missed_blockers.length}):`);
  if (d.missed_blockers.length) {
    lines.push(
      "| id | empresa | bloqueador humano | modelo devolvió | score → acción |",
      "|---|---|---|---|---|",
    );
    for (const x of d.missed_blockers) {
      const instead = [...x.modelo_bloqueadores, ...x.modelo_riesgos.map((r) => `riesgo: ${r}`)];
      lines.push(
        `| ${x.id} | ${x.empresa} | ${x.bloqueador_humano.join("; ")} | ${instead.join("; ") || "nada"} | ${x.modelo_score} → ${x.modelo_accion} |`,
      );
    }
  }
  lines.push("", `Bloqueadores del modelo sin bloqueador humano (${d.false_blockers.length}):`);
  if (d.false_blockers.length) {
    lines.push(
      "| id | empresa | modelo bloqueó por | riesgo humano | score → acción |",
      "|---|---|---|---|---|",
    );
    for (const x of d.false_blockers) {
      lines.push(
        `| ${x.id} | ${x.empresa} | ${x.modelo_bloqueadores.join("; ")} | ${x.riesgo_humano.join("; ") || "-"} | ${x.modelo_score} → ${x.modelo_accion} |`,
      );
    }
  }
  if (m.anchor === "human_score_match") {
    lines.push("", `Riesgos humanos no detectados (${d.missed_risks.length}):`);
    if (d.missed_risks.length) {
      lines.push(
        "| id | empresa | riesgo humano | modelo devolvió | location_ok modelo |",
        "|---|---|---|---|---|",
      );
      for (const x of d.missed_risks) {
        const instead = [
          ...x.modelo_riesgos,
          ...x.modelo_bloqueadores.map((b) => `bloqueador: ${b}`),
        ];
        lines.push(
          `| ${x.id} | ${x.empresa} | ${x.riesgo_humano.join("; ")} | ${instead.join("; ") || "nada"} | ${x.modelo_location_ok} |`,
        );
      }
    }
  }
  lines.push("", `location_ok distinto del humano (${d.location_mismatches.length}):`);
  if (d.location_mismatches.length) {
    lines.push("| id | empresa | ubicacion_raw | humano | modelo |", "|---|---|---|---|---|");
    for (const l of d.location_mismatches) {
      lines.push(`| ${l.id} | ${l.empresa} | ${l.ubicacion_raw} | ${l.humano} | ${l.modelo} |`);
    }
  }
  const failed = report.jobs.filter((j) => j.errors.length);
  if (failed.length) {
    lines.push(
      "",
      `Jobs con llamadas fallidas: ${failed.map((j) => `${j.id} (${j.errors.length})`).join(", ")}`,
    );
  }
  return lines.join("\n");
}
