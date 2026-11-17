import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createDemoLlm,
  createLlmClient,
  createLogger,
  createProviderRegistry,
  drizzleCallSink,
  generateFromEnv,
  memoryCallSink,
  parseThinkingLevel,
  providerForModel,
  staticRouteSource,
  type CallSink,
  type LlmClient,
  type RouteConfig,
} from "@job-search-os/adapters";
import { createDb, loadLocalEnv, requireDatabaseUrl } from "@job-search-os/db";
import routingSeed from "../../../packages/db/seeds/model_routing.json";
import { loadCvCoachGolden } from "./golden";
import {
  CV_COACH_EVAL_DEFAULT_MAX_USD,
  CV_COACH_EVAL_LABEL,
  CV_COACH_EVAL_TANDA_CAP_USD,
  checkCoachEstimate,
  createCoachBudget,
  estimateCoachRun,
  tandaBudget,
  unlimitedCoachBudget,
  type CoachEvalStage,
} from "./guard";
import { recordingLlm, replayLlm, type RecordedTranscript } from "./recorded";
import { buildCoachReport, formatCoachReport, type CoachEvalMode } from "./report";
import { labeledLlm, runConversation, type ConversationOutcome } from "./run";
import { simulatedLlm } from "./simulated";

/**
 * Harness del coach de CV (R12-13). Desde `evals/`:
 *
 *   pnpm exec tsx src/cv-coach/cli.ts [--modo demo|simulada|grabada|modelo] [--etapa charla|diagnostico]
 *     [--ids a,b] [--privadas] [--runs 1] [--max-usd 0.60] [--db local|cloud|none] [--grabar]
 *     [--dry-run] [--no-report]
 *
 * - `--modo demo` (por defecto): modelo de demo, sin red y sin gasto. Sirve para probar el circuito.
 * - `--modo simulada`: un modelo falso que «contesta» con la fixture (`simulated.ts`), sin red y sin gasto. Con
 *   `--grabar` arma las transcripciones de prueba de `grabadas/` (`origen: simulada`).
 * - `--modo grabada`: vuelve a correr las transcripciones de `evals/fixtures/cv-coach/grabadas/`, sin modelo.
 * - `--modo modelo`: el modelo real de `model_routing` (sin respaldo, como los evals del evaluador). **Gasta**:
 *   lo corre Mauro. Exige `--db local|cloud` para leer lo que ya gastó la tanda (`llm_calls` con
 *   `label = r12`): si pasa USD 2,50 no se corre, y lo que queda achica `--max-usd`.
 * - `--etapa diagnostico`: solo `cv_review` (≈ USD 0,014 por CV); `charla` (por defecto) suma la charla
 *   guionada y la redacción (≈ USD 0,11 por CV).
 * - `--privadas`: suma `fixtures-private/cv-coach/*.json`. De ellas el reporte guarda solo métricas.
 * - `--grabar`: guarda la transcripción de cada fixture **pública** en `grabadas/` (nunca las privadas).
 * - `--dry-run`: muestra el plan y el estimado y sale sin llamar a nada.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const GRABADAS_DIR = resolve(HERE, "../../fixtures/cv-coach/grabadas");
const REPORTS_DIR = resolve(HERE, "../../reports/cv-coach");
const COACH_TASKS = ["cv_review", "cv_coach_turn", "cv_write"] as const;

type Flags = Record<string, string>;

function parseFlags(argv: string[]): Flags {
  const flags: Flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith("--")) throw new Error(`argumento suelto: ${a}`);
    const [k, inline] = a.slice(2).split("=", 2);
    const v = inline ?? (argv[i + 1] && !argv[i + 1]!.startsWith("--") ? argv[++i]! : "true");
    flags[k!] = v;
  }
  return flags;
}

/** Rutas de las tres tareas del coach, del seed y sin modelo de respaldo. */
export function coachRoutes(): RouteConfig[] {
  return COACH_TASKS.map((task) => {
    const r = routingSeed.find((x) => x.task === task);
    if (!r) throw new Error(`seeds/model_routing.json no tiene ${task}`);
    return {
      task,
      provider: providerForModel(r.model, r.provider),
      model: r.model,
      fallbackModel: null,
      temperature: r.temperature,
      maxTokens: r.max_tokens,
      thinkingLevel: parseThinkingLevel(r.thinking_level),
      inputUsdPerMtok: r.input_usd_per_mtok,
      outputUsdPerMtok: r.output_usd_per_mtok,
      fallbackInputUsdPerMtok: null,
      fallbackOutputUsdPerMtok: null,
    };
  });
}

function loadTranscript(id: string): RecordedTranscript {
  const path = join(GRABADAS_DIR, `${id}.json`);
  return JSON.parse(readFileSync(path, "utf8")) as RecordedTranscript;
}

async function main(): Promise<void> {
  loadLocalEnv();
  process.env.LOG_LEVEL ??= "warn";
  const flags = parseFlags(process.argv.slice(2));
  const mode = (flags.modo ?? "demo") as CoachEvalMode;
  if (!["demo", "simulada", "grabada", "modelo"].includes(mode))
    throw new Error("--modo: demo, simulada, grabada o modelo");
  const stage = (flags.etapa ?? "charla") as CoachEvalStage;
  if (!["charla", "diagnostico"].includes(stage)) throw new Error("--etapa: charla o diagnostico");
  const runs = Number(flags.runs ?? 1);
  if (!Number.isInteger(runs) || runs < 1 || runs > 3) throw new Error("--runs: 1 a 3");
  const maxUsd = Number(flags["max-usd"] ?? CV_COACH_EVAL_DEFAULT_MAX_USD);
  const dbMode = flags.db ?? "none";
  if (!["local", "cloud", "none"].includes(dbMode)) throw new Error("--db: local, cloud o none");
  const ids = flags.ids ? flags.ids.split(",").map((s) => s.trim()) : undefined;
  const privadas = flags.privadas === "true";
  if (privadas && mode === "grabada")
    throw new Error("las fixtures privadas no tienen transcripciones grabadas");
  if (privadas && mode === "simulada")
    throw new Error("el modelo simulado es para las fixtures públicas");

  let golden = loadCvCoachGolden({ privadas, ...(ids ? { ids } : {}) });
  // Grabadas: solo las públicas que tienen transcripción
  if (mode === "grabada") {
    golden = golden.filter(
      (g) => g.source === "public" && existsSync(join(GRABADAS_DIR, `${g.fixture.id}.json`)),
    );
  }
  if (golden.length === 0) throw new Error("ninguna fixture para correr (revisá --ids)");
  const conversations = golden.length * runs;
  const estimate = estimateCoachRun(conversations, stage);
  process.stderr.write(
    `plan: ${golden.length} fixture(s) × ${runs} corrida(s), etapa ${stage}, modo ${mode}` +
      ` (${golden.filter((g) => g.source === "private").length} privada(s))\n` +
      `costo estimado con el modelo real: USD ${estimate.usd.toFixed(3)} (${estimate.calls} llamadas típicas)\n`,
  );

  // Tope de la tanda y de la corrida: solo importan con el modelo real, pero el dry-run los muestra igual
  let conn: ReturnType<typeof createDb> | null = null;
  let effectiveMax = maxUsd;
  if (mode === "modelo") {
    if (dbMode === "none") {
      throw new Error(
        "--modo modelo exige --db local|cloud: sin leer llm_calls no se puede garantizar el tope de la tanda (USD 2,50)",
      );
    }
    conn = createDb(
      requireDatabaseUrl({ purpose: "service", target: dbMode as "local" | "cloud" }),
      { max: 2 },
    );
    const [row] = await conn.sql<{ usd: number }[]>`
      select coalesce(sum(cost_usd), 0)::float8 as usd from llm_calls where label = ${CV_COACH_EVAL_LABEL}`;
    const accumulated = Number(row?.usd ?? NaN);
    const tanda = tandaBudget(maxUsd, accumulated);
    if (!tanda.ok) {
      await conn.close();
      throw new Error(tanda.reason);
    }
    effectiveMax = tanda.maxUsd;
    process.stderr.write(
      `tanda: USD ${accumulated.toFixed(3)} gastados de ${CV_COACH_EVAL_TANDA_CAP_USD} (label ${CV_COACH_EVAL_LABEL}); tope de esta corrida USD ${effectiveMax.toFixed(3)}\n`,
    );
    const check = checkCoachEstimate(estimate, effectiveMax);
    if (!check.ok) {
      await conn.close();
      throw new Error(check.reason);
    }
  }
  if (flags["dry-run"] === "true") {
    process.stderr.write("dry-run: no se llamó a nada\n");
    await conn?.close();
    return;
  }

  const budget = mode === "modelo" ? createCoachBudget(effectiveMax) : unlimitedCoachBudget();
  let baseLlm: LlmClient | null = null;
  if (mode === "demo") baseLlm = createDemoLlm();
  if (mode === "modelo") {
    const sink: CallSink = conn ? drizzleCallSink(conn.db) : memoryCallSink();
    baseLlm = createLlmClient({
      routes: staticRouteSource(coachRoutes()),
      calls: sink,
      providers: createProviderRegistry(),
      logger: createLogger({ run_id: `evals-r12-${Date.now()}` }),
      generate: generateFromEnv(),
    });
  }

  const outcomes: { source: "public" | "private"; run: number; outcome: ConversationOutcome }[] =
    [];
  try {
    for (let run = 0; run < runs; run++) {
      for (const g of golden) {
        const inner =
          mode === "grabada"
            ? replayLlm(loadTranscript(g.fixture.id))
            : mode === "simulada"
              ? simulatedLlm(g.fixture)
              : baseLlm!;
        const recorder =
          flags.grabar === "true" && g.source === "public" ? recordingLlm(inner) : null;
        const llm = labeledLlm(recorder ? recorder.llm : inner, CV_COACH_EVAL_LABEL);
        const outcome = await runConversation(g, { llm, budget, stage });
        outcomes.push({ source: g.source, run, outcome });
        process.stderr.write(
          `  ${g.source === "private" ? "(privada)" : g.fixture.id}: ${outcome.record.calls} llamadas\n`,
        );
        if (recorder && run === 0) {
          mkdirSync(GRABADAS_DIR, { recursive: true });
          const t: RecordedTranscript = {
            fixtureId: g.fixture.id,
            origen: mode === "modelo" ? "modelo" : "simulada",
            nota: `grabada con --modo ${mode} el ${new Date().toISOString().slice(0, 10)}`,
            calls: recorder.calls,
          };
          writeFileSync(
            join(GRABADAS_DIR, `${g.fixture.id}.json`),
            `${JSON.stringify(t, null, 2)}\n`,
          );
        }
        if (budget.cut()) break;
      }
      if (budget.cut()) break;
    }
  } finally {
    await conn?.close();
  }

  const report = buildCoachReport({
    mode,
    stage,
    runs,
    maxUsd: effectiveMax,
    outcomes,
    cut: budget.cut(),
  });
  process.stdout.write(formatCoachReport(report));
  if (flags["no-report"] !== "true") {
    mkdirSync(REPORTS_DIR, { recursive: true });
    const name = `${new Date().toISOString().slice(0, 10)}_${mode}_${stage}${budget.cut() ? "_cortado" : ""}.json`;
    writeFileSync(join(REPORTS_DIR, name), `${JSON.stringify(report, null, 2)}\n`);
    process.stderr.write(`reporte: evals/reports/cv-coach/${name}\n`);
  }
  if (budget.cut()) process.exitCode = 2;
}

main().catch((e: unknown) => {
  process.stderr.write(`error: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
